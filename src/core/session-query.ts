import type {
  SessionFrame,
  SessionSnapshot,
  PromptCommand,
} from "@fungi.computer/shiitake/client";
import {
  experimental_streamedQuery,
  infiniteQueryOptions,
  queryOptions,
  QueryObserver,
  type QueryClient,
} from "@tanstack/react-query";

import type { ParakeetSession } from "../session.js";
import { applySessionFrame } from "./session-projection.js";
import { reportFailure } from "../lib/failure.js";

type SessionObservation =
  | Readonly<{ kind: "opening" }>
  | Readonly<{ kind: "snapshot"; value: SessionSnapshot }>
  | Readonly<{ kind: "frame"; value: SessionFrame }>;

type SessionProjection = Readonly<{
  /** Whether the current watch has supplied a fresh owner baseline. */
  observation: "connecting" | "live";
  /** Last coherent durable Session state, absent before the first snapshot. */
  snapshot: SessionSnapshot | undefined;
  /** One retryable user prompt, including image cargo, survives page refreshes. */
  latestPrompt:
    | Readonly<{
        /** Owner-issued identity of the original prompt command. */
        commandId: string;
        /** Original user text, including an empty image-only prompt body. */
        text: string;
        /** Original image content retained for a fresh retry admission. */
        images: PromptCommand["images"];
      }>
    | undefined;
}>;

const emptyProjection: SessionProjection = Object.freeze({
  observation: "connecting",
  snapshot: undefined,
  latestPrompt: undefined,
});

// A watch starts with a bounded page, but its update frames keep arriving for
// the lifetime of the client. Refresh from the owner before that page becomes
// an ever-growing in-memory transcript. The smaller read leaves room for a
// burst of frames without reading on every tool result.
const LIVE_HISTORY_LIMIT = 200;
const LIVE_HISTORY_REFRESH_AT = 400;

function latestPrompt(
  messages: SessionSnapshot["messages"],
  previous?: SessionProjection["latestPrompt"],
): SessionProjection["latestPrompt"] {
  for (const message of messages.slice().reverse()) {
    if (message.value.role !== "user" || message.commandId === null) continue;
    const content = message.value.content;
    const text = Array.isArray(content)
      ? content
          .flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n")
      : content;
    const images = Array.isArray(content)
      ? content.filter((part) => part.type === "image")
      : [];
    return {
      commandId: message.commandId,
      text,
      images: images.length === 0 ? undefined : images,
    };
  }
  return previous;
}

async function* observeSession(
  session: ParakeetSession,
  signal: AbortSignal,
): AsyncGenerator<SessionObservation> {
  yield { kind: "opening" };
  const watch = await session.watch({ limit: LIVE_HISTORY_LIMIT });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= watch.close();
    return closing;
  };
  const onAbort = (): void => {
    // The generator finalizer collects this same promise; observe it immediately.
    void close().catch((cause: unknown) => {
      reportFailure("close aborted Session watch", cause);
    });
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal.aborted) return;
    let snapshot = watch.snapshot;
    yield { kind: "snapshot", value: snapshot };
    for await (const frame of watch.changes) {
      snapshot = applySessionFrame(snapshot, frame);
      if (snapshot.messages.length > LIVE_HISTORY_REFRESH_AT) {
        snapshot = await session.read({ limit: LIVE_HISTORY_LIMIT });
        yield { kind: "snapshot", value: snapshot };
      } else {
        yield { kind: "frame", value: frame };
      }
    }
    throw new Error("Session watch ended; current activity is unavailable");
  } catch (error) {
    if (!signal.aborted) throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    await close();
  }
}

function reduceObservation(
  projection: SessionProjection,
  observation: SessionObservation,
): SessionProjection {
  if (observation.kind === "opening")
    return { ...projection, observation: "connecting" };
  if (observation.kind === "snapshot")
    return {
      observation: "live",
      snapshot: observation.value,
      latestPrompt: latestPrompt(
        observation.value.messages,
        projection.latestPrompt,
      ),
    };
  if (projection.snapshot === undefined)
    return observation.value.kind === "reset"
      ? {
          observation: "live",
          snapshot: observation.value.baseline,
          latestPrompt: latestPrompt(observation.value.baseline.messages),
        }
      : projection;
  const snapshot = applySessionFrame(projection.snapshot, observation.value);
  return {
    observation: "live",
    snapshot,
    latestPrompt: latestPrompt(snapshot.messages, projection.latestPrompt),
  };
}

/** One shared TanStack observation keyed by Shiitake's logical Session address. */
export function sessionQueryOptions(session: ParakeetSession) {
  const queryKey = ["shiitake-session", session.address] as const;
  return queryOptions({
    queryKey,
    queryFn: experimental_streamedQuery<
      SessionObservation,
      SessionProjection,
      typeof queryKey
    >({
      streamFn: ({ signal }) => observeSession(session, signal),
      reducer: reduceObservation,
      initialValue: emptyProjection,
      refetchMode: "append",
    }),
    refetchOnMount: "always",
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Seed the shared observation with a bounded read before its watch mounts. */
export function seedSessionQuery(
  queryClient: QueryClient,
  session: ParakeetSession,
  snapshot: SessionSnapshot,
): void {
  queryClient.setQueryData(sessionQueryOptions(session).queryKey, {
    observation: "connecting",
    snapshot,
    latestPrompt: latestPrompt(snapshot.messages),
  });
}

/** Longest header a Session activity may carry. */
const maximumActivityHeader = 80;

/** Observed Session activity; `header` is only an attention item's short heading. */
export type SessionActivity = Readonly<{
  /** The Session's observed activity. */
  state: "idle" | "working" | "blocked" | "unknown";
  /** Present when blocked by attention items: their short headings only. */
  header?: string;
}>;

/**
 * Borrow activity from the existing cache without starting another watch.
 * An open attention item (such as an unanswered question) reports `blocked`
 * ahead of working and idle; the header comes only from the question extension.
 */
export function subscribeSessionActivity(
  queryClient: QueryClient,
  session: ParakeetSession,
  listener: (activity: SessionActivity) => void,
  questionExtensionId: string | undefined,
): () => void {
  const observer = new QueryObserver(queryClient, {
    ...sessionQueryOptions(session),
    enabled: false,
  });
  const report = (result: ReturnType<typeof observer.getCurrentResult>) => {
    const snapshot = result.data?.snapshot;
    if (
      result.isError ||
      result.data?.observation !== "live" ||
      snapshot === undefined
    )
      listener({ state: "unknown" });
    else if (
      snapshot.attention.some(
        (item) =>
          item.kind === "question" ||
          item.kind === "goal-blocked" ||
          item.kind === "goal-stalled",
      )
    ) {
      // Only the question owner's short headers may leave the Session.
      const header = snapshot.attention
        .filter(
          (item) =>
            questionExtensionId !== undefined &&
            item.kind === "question" &&
            item.extensionId === questionExtensionId,
        )
        .map((item) => item.summary)
        .join(", ")
        .slice(0, maximumActivityHeader);
      listener(
        header === "" ? { state: "blocked" } : { state: "blocked", header },
      );
    } else
      listener({
        state: snapshot.activity.queue.state === "idle" ? "idle" : "working",
      });
  };
  const unsubscribe = observer.subscribe(report);
  report(observer.getCurrentResult());
  return unsubscribe;
}

/** A before-only Session read plus bounded cursors for returning to newer pages. */
type SessionHistoryCursor = Readonly<{
  before: string | null;
  newerBefore: readonly string[];
  newerOverflow: boolean;
}>;

/** Shared, demand-loaded history; the live watch remains a separate small tail. */
export function sessionHistoryQueryOptions(
  session: ParakeetSession,
  before: string | null = null,
) {
  const initialPageParam: SessionHistoryCursor = {
    before,
    newerBefore: [],
    newerOverflow: false,
  };
  return infiniteQueryOptions({
    queryKey: ["shiitake-session-history", session.address],
    initialPageParam,
    queryFn: async ({ pageParam, signal }) => {
      if (pageParam.before === null)
        throw new Error("Session has no older history cursor");
      const page = await session.read({ before: pageParam.before, limit: 100 });
      signal.throwIfAborted();
      return page;
    },
    getNextPageParam: (
      last,
      _pages,
      cursor,
    ): SessionHistoryCursor | undefined => {
      if (last.oldestCursor === null || last.oldestCursor === undefined)
        return undefined;
      const newerBefore =
        cursor.before === null
          ? cursor.newerBefore
          : [...cursor.newerBefore, cursor.before];
      return {
        before: last.oldestCursor,
        newerBefore: newerBefore.slice(-2048),
        newerOverflow: cursor.newerOverflow || newerBefore.length > 2048,
      };
    },
    getPreviousPageParam: (
      _first,
      _pages,
      cursor,
    ): SessionHistoryCursor | undefined => {
      const before = cursor.newerBefore.at(-1);
      return before === undefined
        ? undefined
        : {
            before,
            newerBefore: cursor.newerBefore.slice(0, -1),
            newerOverflow: cursor.newerOverflow,
          };
    },
    select: (data) => ({
      pages: data.pages,
      newerOverflow: data.pageParams[0]?.newerOverflow ?? false,
    }),
    maxPages: 4,
    enabled: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
