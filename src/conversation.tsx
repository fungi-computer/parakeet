import { noAuthor, type ParakeetAuthorOf } from "./core/author-labels.js";
import { nanoid } from "@fungi.computer/cairn";
import {
  type PromptDelivery,
  type PromptCommand,
  type SessionPendingPrompt,
  type SessionActivity,
  type SessionCompactionMarker,
  type SessionCompactionNotice,
  type SessionContext,
  type SessionExtensionSlots,
  type SessionMessage,
  type SessionPendingPrompts,
  type SessionSnapshot,
} from "@fungi.computer/shiitake/client";
import type { ClientEntryV1 } from "@fungi.computer/shiitake/client-entry";
import {
  createClientContributions,
  type ClientContribution,
} from "./core/client-contributions.js";
import {
  createParakeetInteractions,
  type ParakeetInteractions,
  type ParakeetToast,
} from "./commands/interactions.js";
import type { WhistleExecutionOutcome } from "@fungi.computer/whistle";
import {
  CancelledError,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  atom,
  createStore,
  type Atom,
  type PrimitiveAtom,
  type WritableAtom,
} from "jotai/vanilla";
import {
  atomWithInfiniteQuery,
  atomWithMutation,
  atomWithQuery,
} from "jotai-tanstack-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  buildDurableTimeline,
  buildTimelineTail,
  type PromptRequestIdOf,
} from "./core/build-timeline.js";
import {
  mergeCompactionNotices,
  mergeCompactions,
  mergeMessages,
} from "./core/session-projection.js";
import {
  sessionHistoryQueryOptions,
  sessionQueryOptions,
} from "./core/session-query.js";
import {
  sameSessionViewState,
  sessionActivityStatus,
  sessionViewState,
  type SessionViewState,
} from "./core/session-view-state.js";
import { isCancelledOutcome } from "./commands/run.js";
import type { ParakeetSession } from "./session.js";
import type { LocalPromptAdmission, TimelineItem } from "./store/types.js";
import { reportFailure } from "./lib/failure.js";
import {
  createQueuedRecall,
  type QueuedRecall,
  type QueuedRecallState,
  type QueuedRecallOutcome,
} from "./core/queued-recall.js";
import {
  draftJournal,
  type ParakeetDraftIdentity,
  type ParakeetDraftStorage,
} from "./core/draft-storage.js";

const noMessages: readonly SessionMessage[] = Object.freeze([]);
const noCompactions: readonly SessionCompactionMarker[] = Object.freeze([]);
const noCompactionNotices: readonly SessionCompactionNotice[] = Object.freeze(
  [],
);

const noClients: readonly ClientEntryV1[] = Object.freeze([]);
const noContributions: readonly ClientContribution[] = Object.freeze([]);
const noSlots: SessionExtensionSlots = Object.freeze({});
const noPending: SessionPendingPrompts = Object.freeze({
  total: 0,
  hasMore: false,
  prompts: Object.freeze([]),
});
type SubmittedPromptAdmission = LocalPromptAdmission &
  Readonly<{
    submittedDraft: string;
    restoreDraft: boolean;
  }>;
const connecting: ParakeetObservation = Object.freeze({ status: "connecting" });
const live: ParakeetObservation = Object.freeze({ status: "live" });

/** Stable model identity presented by the current Session. */
export type ParakeetModel = Readonly<{
  /** Provider model identifier. */
  model: string;
  /** Provider identifier. */
  provider: string;
}>;

/** Aggregate usage presented by the current Session timeline. */
export type ParakeetUsage = Readonly<{
  /** Accumulated provider cost. */
  cost: number;
  /** Accumulated token count. */
  tokens: number;
}>;

/** Conversation activity presented by Parakeet. */
export type ParakeetStatus =
  | "connecting"
  | "cancelling"
  | "error"
  | "idle"
  | "queued"
  | "retrying"
  | "sending"
  | "streaming"
  | "thinking"
  | "disconnected";

/** Owner activity with the connection states shown while observation opens. */
export type ParakeetSessionViewState =
  | SessionViewState
  | Readonly<{
      /** Session observation is opening. */
      kind: "connecting";
    }>
  | Readonly<{
      /** Session observation is unavailable. */
      kind: "disconnected";
      /** Reason suitable for presentation. */
      cause: string;
    }>;

/** Health of the current Session observation. */
export type ParakeetObservation =
  | Readonly<{
      /** Observation is opening. */
      status: "connecting";
    }>
  | Readonly<{
      /** Observation is current. */
      status: "live";
    }>
  | Readonly<{
      /** Observation failed and can be reopened. */
      status: "unavailable";
      /** Sanitized reason suitable for presentation. */
      reason: string;
    }>;

/** Stable history and replaceable work rendered by a conversation client. */
export type TimelineController = Readonly<{
  /** Remove one owner-admitted queued prompt, never the running turn or draft. */
  cancelQueued: (commandId: string) => Promise<void>;
  /** A queued-input gesture is waiting for its owner. */
  cancellingQueued: boolean;
  /** Durable-backed rows whose identity is stable across progress revisions. */
  settled: readonly TimelineItem[];
  /** Replaceable progress, queued, and optimistic rows. */
  tail: readonly TimelineItem[];
  /** Fixed committed Session positions resolved within the loaded history. */
  positionAnchors: ReadonlyMap<number, string | null>;
  /** Last actually rendered durable row for each loaded command. */
  commandAnchors: ReadonlyMap<string, string>;
  /** Current owner-admitted prompts, independent of the visible history page. */
  queued: SessionPendingPrompts;
  /** Whether more admitted prompts exist beyond this projection. */
  pendingHasMore: boolean;
  /** Whether older history remains, unloaded, before `settled[0]`. */
  hasMoreHistory: boolean;
  /** An older history page is currently loading. */
  loadingOlderHistory: boolean;
  /** Load the next older history page; a no-op while one is in flight. */
  loadOlderHistory: () => void;
  /** Whether a newer evicted page lies beyond the retained history window. */
  hasNewerHistory: boolean;
  /** Refetch the nearest newer page after browsing backward. */
  loadNewerHistory: () => void;
  /** Keep the currently read page visible while the live tail advances. */
  pinVisibleHistory: () => void;
  /** Return to the live page and release paged history. */
  jumpToLatest: () => void;
  /** Newest durable assistant model identity. */
  model?: ParakeetModel | undefined;
  /** Accumulated durable usage. */
  usage?: ParakeetUsage | undefined;
}>;

/** A host may proceed with restart only after the current journal committed. */
export type ParakeetDraftCheckpoint =
  | Readonly<{
      /** The latest draft is committed and restart may proceed. */
      status: "saved";
    }>
  | Readonly<{
      /** Draft persistence failed; the host must not proceed with restart. */
      status: "failed";
      /** Storage failure explanation for the host. */
      reason: string;
    }>;

/** Draft and prompt operations for the current conversation. */
export type ComposerController = Readonly<{
  /** Stop the current turn. Queued prompts keep draining; the draft is unchanged. */
  cancel: () => Promise<void>;
  /** Current local input. */
  draft: string;
  /** Image cargo restored with a queued prompt, carried through the same journal. */
  images: PromptCommand["images"];
  /** Shared composer reservation and recall outcome. */
  recallState: QueuedRecallState;
  /** Recall only when the host accepted a plain Up on empty, focused input. */
  recall: () => Promise<QueuedRecallOutcome>;
  /**
   * Commit the latest draft and pending admissions synchronously, even through
   * a callback captured before newer typing. Does not consume, send or withdraw.
   * A resumed provider reads the same Session journal; never replay a copied
   * draft over its newer state. A failed commit leaves the live draft untouched.
   */
  checkpointDraft: () => ParakeetDraftCheckpoint;
  /** Typed reason the latest prompt did not complete. */
  failure: "admission" | "failed" | "cancelled" | "interrupted" | undefined;
  /** Current send could not enter the bounded local admission queue. */
  admissionError: "queue_full" | undefined;
  /** Retry the exact most recent failed prompt. */
  retry: () => void;
  /** Remove one failed local admission from this conversation. */
  dismissFailed: (requestId: string) => void;
  /** Submit the current draft with the requested delivery intent. */
  send: (delivery?: PromptDelivery) => void;
  /**
   * Run a host command, such as Whistle slash dispatch, for the current draft.
   * Parakeet clears the draft only when the command handled it without
   * declining (a refused replacement keeps the text) and the draft was
   * not edited while the command ran. The callback can consume that exact
   * draft on dispatch when the command definition requests it.
   */
  submitCommand: (
    run: (
      draft: string,
      consumeDraft: () => void,
    ) => Promise<WhistleExecutionOutcome | undefined>,
  ) => Promise<WhistleExecutionOutcome | undefined>;
  /** Replace the local input. */
  setDraft: (value: string) => void;
}>;

/** Session activity, observation, and Agent-lifetime controls. */
export type StatusController = Readonly<{
  /** Owner-issued identity of the running or queued Session command. */
  commandId: string | undefined;
  /** Health of the shared Session observation. */
  observation: ParakeetObservation;
  /** Reopen the shared Session observation. */
  reconnect: () => Promise<ParakeetReconnectOutcome>;
  /** Current conversation activity. */
  status: ParakeetStatus;
  /** Owner state, or a typed client connection state when the owner is unreachable. */
  viewState: ParakeetSessionViewState;
  /** Context use as the Session's compaction measures it, once known. */
  context: SessionContext | undefined;
}>;

/** Result of retrying the shared Session observation. */
export type ParakeetReconnectOutcome =
  | Readonly<{
      /** No reconnect was needed. */
      kind: "nothing_to_reconnect";
      /** Existing observation state. */
      state: "connected" | "connecting";
    }>
  | Readonly<{
      /** Session observation reopened. */
      kind: "reconnected";
    }>
  | Readonly<{
      /** Reopening failed. */
      kind: "failed";
      /** Reason suitable for presentation. */
      cause: string;
    }>;

const MAX_UNRESOLVED_LOCAL_ADMISSIONS = 32;

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim().length > 0
    ? cause.message
    : "Prompt admission failed";
}

/** A lost withdrawal response must not block a later reconnect from retrying it. */
function boundWithdrawal<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Request recovery timed out"));
    }, 10_000);
  });
  return Promise.race([operation, deadline]).finally(() => {
    clearTimeout(timer);
  });
}

function observationCause(cause: unknown): string {
  const message =
    cause instanceof Error && cause.message.trim().length > 0
      ? cause.message.trim()
      : "Session history is unavailable";
  return message.slice(0, 500);
}

/**
 * Show Shiitake's Session status as-is; local admission state only refines an
 * owner-reported `idle`.
 */
function composerStatus(
  snapshot: SessionSnapshot | undefined,
  admissions: readonly LocalPromptAdmission[],
  failure: ComposerController["failure"],
): ParakeetStatus {
  if (snapshot === undefined) return "connecting";
  const view = sessionViewState(snapshot);
  const status = sessionActivityStatus(view);
  if (status !== "idle") return status;
  if (failure !== undefined || view.kind === "error") return "error";
  if (admissions.some(({ status: state }) => state === "accepted"))
    return "queued";
  if (admissions.some(({ status: state }) => state === "admitting"))
    return "sending";
  return status;
}

function newestDurableCommandId(
  messages: SessionSnapshot["messages"] | undefined,
): string | undefined {
  if (messages === undefined) return undefined;
  let newest: { commandId: string; sequence: number } | undefined;
  for (const message of messages) {
    if (message.value.role !== "user" || message.commandId === null) continue;
    if (newest === undefined || message.sequence > newest.sequence)
      newest = { commandId: message.commandId, sequence: message.sequence };
  }
  return newest?.commandId;
}

function sameImageCargo(
  left: PromptCommand["images"],
  right: PromptCommand["images"],
): boolean {
  const images = left ?? [];
  const originals = right ?? [];
  return (
    images.length === originals.length &&
    images.every((image, index) => {
      const original = originals[index];
      return (
        image.data === original?.data && image.mimeType === original.mimeType
      );
    })
  );
}

type DraftStorageAcquisition =
  | Readonly<{ status: "available"; storage: ParakeetDraftStorage }>
  | Readonly<{ status: "unavailable" }>;

function acquireDraftStorage(
  supplied: ParakeetDraftStorage | undefined,
): DraftStorageAcquisition {
  if (supplied !== undefined) return { status: "available", storage: supplied };
  try {
    const browser: Readonly<{ localStorage?: ParakeetDraftStorage }> =
      globalThis;
    const storage = browser.localStorage;
    return storage === undefined
      ? { status: "unavailable" }
      : { status: "available", storage };
  } catch {
    // An opaque-origin sandbox denies even reading the browser's getter.
    return { status: "unavailable" };
  }
}

function createConversationAtoms(
  session: ParakeetSession,
  queryClient: QueryClient,
  authorOf: ParakeetAuthorOf,
  interactions: ParakeetInteractions,
  draftStorage: DraftStorageAcquisition,
  draftScope: string,
  contributions: Atom<readonly ClientContribution[]>,
  shown: (item: TimelineItem) => boolean,
) {
  const journal = draftJournal(
    draftScope,
    draftStorage.status === "available" ? draftStorage.storage : undefined,
  );
  const saved = journal.read();
  let mounted = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const recoveryReasons = new Map(
    saved.pending.map(({ requestId }) => [
      requestId,
      "Closed before confirmation",
    ]),
  );
  const recovering = new Set<string>();
  const queryAtom = atomWithQuery(
    () => sessionQueryOptions(session),
    () => queryClient,
  );
  const snapshotAtom = atom((get) => get(queryAtom).data?.snapshot);

  const pinnedHistoryAtom = atom<SessionSnapshot | undefined>(undefined);
  const historyBeforeAtom = atom(
    (get) =>
      (get(pinnedHistoryAtom) ?? get(snapshotAtom))?.oldestCursor ?? null,
  );
  const historyAtom = atomWithInfiniteQuery(
    (get) => sessionHistoryQueryOptions(session, get(historyBeforeAtom)),
    () => queryClient,
  );
  const hasMoreHistoryAtom = atom((get) => {
    const history = get(historyAtom);
    return history.data === undefined
      ? get(historyBeforeAtom) !== null
      : history.hasNextPage;
  });
  const loadingOlderHistoryAtom = atom((get) => get(historyAtom).isFetching);
  const hasNewerHistoryAtom = atom((get) => {
    const history = get(historyAtom);
    return history.hasPreviousPage || history.data?.newerOverflow === true;
  });
  const loadOlderHistoryAtom = atom(null, (get) => {
    if (!get(hasMoreHistoryAtom) || get(loadingOlderHistoryAtom)) return;
    void get(historyAtom)
      .fetchNextPage({ cancelRefetch: false, throwOnError: true })
      .catch((cause: unknown) => {
        if (!(cause instanceof CancelledError))
          reportFailure("read older Session history", cause);
      });
  });
  const jumpToLatestAtom = atom(null, (_get, set) => {
    set(pinnedHistoryAtom, undefined);
    void queryClient.resetQueries({
      queryKey: sessionHistoryQueryOptions(session).queryKey,
      exact: true,
    });
  });
  const loadNewerHistoryAtom = atom(null, (get, set) => {
    const history = get(historyAtom);
    if (history.isFetching) return;
    if (!history.hasPreviousPage) {
      if (get(hasNewerHistoryAtom)) set(jumpToLatestAtom);
      return;
    }
    void history
      .fetchPreviousPage({ cancelRefetch: false, throwOnError: true })
      .catch((cause: unknown) => {
        if (!(cause instanceof CancelledError))
          reportFailure("read newer Session history", cause);
      });
  });
  const pinVisibleHistoryAtom = atom(null, (get, set) => {
    if (get(pinnedHistoryAtom) === undefined)
      set(pinnedHistoryAtom, get(snapshotAtom));
  });

  const messagesAtom = atom((get) => {
    const history = get(historyAtom);
    const live = get(snapshotAtom)?.messages ?? noMessages;
    const pages =
      history.data?.pages.flatMap((page) => page.messages) ?? noMessages;
    const pinned = get(pinnedHistoryAtom)?.messages ?? noMessages;
    if (pages.length === 0)
      return pinned.length === 0 ? live : mergeMessages(pinned, live);
    return get(hasNewerHistoryAtom)
      ? pages
      : mergeMessages(mergeMessages(pages, pinned), live);
  });
  const compactionsAtom = atom((get) => {
    const history = get(historyAtom);
    const live = get(snapshotAtom)?.compactions ?? noCompactions;
    const pages =
      history.data?.pages.flatMap(
        (page) => page.compactions ?? noCompactions,
      ) ?? noCompactions;
    const pinned = get(pinnedHistoryAtom)?.compactions ?? noCompactions;
    if (pages.length === 0)
      return pinned.length === 0 ? live : mergeCompactions(pinned, live);
    return get(hasNewerHistoryAtom)
      ? pages
      : mergeCompactions(mergeCompactions(pages, pinned), live);
  });
  const compactionNoticesAtom = atom((get) => {
    const history = get(historyAtom);
    const live = get(snapshotAtom)?.compactionNotices ?? noCompactionNotices;
    const pages =
      history.data?.pages.flatMap(
        (page) => page.compactionNotices ?? noCompactionNotices,
      ) ?? noCompactionNotices;
    const pinned =
      get(pinnedHistoryAtom)?.compactionNotices ?? noCompactionNotices;
    if (pages.length === 0)
      return pinned.length === 0 ? live : mergeCompactionNotices(pinned, live);
    return get(hasNewerHistoryAtom)
      ? pages
      : mergeCompactionNotices(mergeCompactionNotices(pages, pinned), live);
  });
  const newestCommandAtom = atom(
    (get) =>
      get(queryAtom).data?.latestPrompt?.commandId ??
      newestDurableCommandId(get(messagesAtom)),
  );
  const pendingAtom = atom((get) => get(snapshotAtom)?.pending ?? noPending);
  // Presentation only: owner snapshots and admission reconciliation stay intact.
  const hiddenQueuedAtom = atom<ReadonlySet<string>>(new Set<string>());
  const cancellingQueuedAtom = atom<string | undefined>(undefined);
  const visiblePendingAtom = atom((get) => {
    const pending = get(pendingAtom);
    const hidden = get(hiddenQueuedAtom);
    const prompts = pending.prompts.filter(
      ({ commandId }) => !hidden.has(commandId),
    );
    return prompts.length === pending.prompts.length
      ? pending
      : {
          ...pending,
          prompts,
          total: pending.total - (pending.prompts.length - prompts.length),
        };
  });
  const reconcileQueuedCancellationAtom = atom(null, (get, set) => {
    const hidden = get(hiddenQueuedAtom);
    const pending = new Set(
      get(pendingAtom).prompts.map(({ commandId }) => commandId),
    );
    const retained = new Set(
      [...hidden].filter(
        (id) => id === get(cancellingQueuedAtom) || pending.has(id),
      ),
    );
    if (retained.size !== hidden.size) set(hiddenQueuedAtom, retained);
  });
  const extensionsAtom = atom(
    (get): SessionExtensionSlots => get(snapshotAtom)?.extensions ?? noSlots,
  );
  let liveToolActivity: SessionActivity | undefined;
  const toolActivityAtom = atom((get) => {
    const query = get(queryAtom);
    const activity = get(snapshotAtom)?.activity;
    if (
      query.isError ||
      query.data?.observation !== "live" ||
      activity?.queue.state !== "running" ||
      activity.activeTool === null
    ) {
      liveToolActivity = undefined;
      return undefined;
    }
    if (
      liveToolActivity?.queue.state === "running" &&
      liveToolActivity.queue.commandId === activity.queue.commandId &&
      liveToolActivity.activeTool === activity.activeTool
    )
      return liveToolActivity;
    liveToolActivity = activity;
    return liveToolActivity;
  });
  /** Each accepted local prompt's request identity, by its owner command. */
  const promptRequestIdsAtom = atom<ReadonlyMap<string, string>>(new Map());
  const requestIdOfAtom = atom((get): PromptRequestIdOf => {
    const requestIds = get(promptRequestIdsAtom);
    return (commandId) => requestIds.get(commandId);
  });
  const durableAtom = atom((get) => {
    const messages = get(messagesAtom);
    const compactions = get(compactionsAtom);
    const notices = get(compactionNoticesAtom);
    const sequences = [
      ...messages.map((message) => message.sequence),
      ...compactions.map((marker) => marker.sequence),
      ...notices.map((notice) => notice.sequence),
    ];
    const oldest = Math.min(...sequences);
    const newest = Math.max(...sequences);
    const positions = get(contributions).flatMap(({ value }) =>
      value.timeline.cells.flatMap(({ afterSequence }) =>
        afterSequence === undefined ||
        (get(hasMoreHistoryAtom) && afterSequence < oldest) ||
        (get(hasNewerHistoryAtom) && afterSequence > newest)
          ? []
          : [afterSequence],
      ),
    );
    return buildDurableTimeline(
      messages,
      compactions,
      get(toolActivityAtom),
      authorOf,
      get(requestIdOfAtom),
      notices,
      positions,
      shown,
    );
  });
  const draftAtom = atom(saved.draft);
  const draftImagesAtom = atom<PromptCommand["images"]>(saved.images);
  const draftDeliveryAtom = atom<PromptDelivery | undefined>(saved.delivery);
  const recallReservationAtom = atom<SessionPendingPrompt | undefined>(
    saved.recall,
  );
  const recallStateAtom = atom<QueuedRecallState>({ kind: "idle" });
  let recallOwner: QueuedRecall | undefined;
  const draftRevisionAtom = atom(0);
  const rawAdmissionsAtom = atom<readonly SubmittedPromptAdmission[]>(
    saved.pending.map((pending): SubmittedPromptAdmission => ({
      ...pending,
      status: "admitting",
    })),
  );
  const persistAtom = atom(
    null,
    (
      get,
      _set,
      state?: Readonly<{
        draft?: string;
        draftPayload?: Readonly<{
          images?: PromptCommand["images"];
          delivery?: PromptDelivery | undefined;
        }>;
        recall?: SessionPendingPrompt | null;
        admissions?: readonly SubmittedPromptAdmission[];
      }>,
    ) => {
      // Unavailable storage is session-only, not a pretend durable journal.
      // A supplied adapter's write failures still refuse durable operations.
      if (draftStorage.status === "unavailable") return;
      journal.write({
        draft: state?.draft ?? get(draftAtom),
        images:
          state?.draftPayload === undefined
            ? get(draftImagesAtom)
            : state.draftPayload.images,
        delivery:
          state?.draftPayload === undefined
            ? get(draftDeliveryAtom)
            : state.draftPayload.delivery,
        recall:
          state?.recall === null
            ? undefined
            : (state?.recall ?? get(recallReservationAtom)),
        pending: (state?.admissions ?? get(rawAdmissionsAtom))
          .filter(({ status }) => status === "admitting")
          .map(
            ({
              requestId,
              content,
              submittedDraft,
              delivery,
              images,
              restoreDraft,
            }) => ({
              requestId,
              content,
              submittedDraft,
              delivery,
              images,
              restoreDraft,
            }),
          ),
      });
    },
  );
  const recallAtom = atom(null, (get, set): Promise<QueuedRecallOutcome> => {
    if (get(cancellingQueuedAtom) !== undefined)
      return Promise.resolve("ignored");
    recallOwner ??= createQueuedRecall({
      session: {
        latestPending: () => session.latestPending(),
        cancel: (input) => session.command({ type: "cancel", ...input }),
      },
      recovery: get(recallReservationAtom),
      emptyDraftRevision: () =>
        get(draftAtom) === "" && (get(draftImagesAtom)?.length ?? 0) === 0
          ? get(draftRevisionAtom)
          : undefined,
      reserve: (prompt) => {
        set(persistAtom, { recall: prompt });
        set(recallReservationAtom, prompt);
      },
      forget: () => {
        set(persistAtom, { recall: null });
        set(recallReservationAtom, undefined);
      },
      restore: (prompt, revision) => {
        if (
          get(draftRevisionAtom) !== revision ||
          get(draftAtom) !== "" ||
          (get(draftImagesAtom)?.length ?? 0) !== 0
        )
          return false;
        set(persistAtom, {
          draft: prompt.text,
          draftPayload: { images: prompt.images, delivery: prompt.delivery },
          recall: null,
        });
        set(recallReservationAtom, undefined);
        set(draftImagesAtom, prompt.images);
        set(draftDeliveryAtom, prompt.delivery);
        set(draftAtom, prompt.text);
        set(draftRevisionAtom, (current) => current + 1);
        return true;
      },
      onState: (state) => {
        set(recallStateAtom, state);
        if (state.kind === "too_late" || state.kind === "uncertain")
          interactions.toast({ variant: "warning", message: state.message });
      },
    });
    return recallOwner.recall();
  });
  const latestSubmissionIdAtom = atom<string | undefined>(undefined);
  const checkpointDraftAtom = atom(
    null,
    (_get, set): ParakeetDraftCheckpoint => {
      if (!mounted)
        return {
          status: "failed",
          reason: "Conversation is no longer mounted",
        };
      if (draftStorage.status === "unavailable")
        return {
          status: "failed",
          reason: "Durable draft storage is unavailable",
        };
      try {
        set(persistAtom);
        return { status: "saved" };
      } catch (cause) {
        return { status: "failed", reason: errorMessage(cause) };
      }
    },
  );
  const observedCommandIdsAtom = atom(
    (get) =>
      new Set([
        ...get(durableAtom).commandIds,
        ...get(pendingAtom).prompts.map(({ commandId }) => commandId),
        ...(get(snapshotAtom)?.terminals.map(({ commandId }) => commandId) ??
          []),
      ]),
  );
  const admissionsAtom = atom((get) => {
    const knownCommandIds = get(observedCommandIdsAtom);
    return get(rawAdmissionsAtom).filter(
      (admission) =>
        admission.status === "failed" ||
        admission.commandId === undefined ||
        !knownCommandIds.has(admission.commandId),
    );
  });
  /** Retire a successful local admission only after owner identity is observed. */
  const reconcileAdmissionsAtom = atom(null, (get, set) => {
    const knownCommandIds = get(observedCommandIdsAtom);
    const observedRequests = new Map([
      // Recorded replies have no command: their accepted receipt names the
      // durable entry, not model admission or cancellation.
      ...get(messagesAtom).flatMap(
        ({ id, requestId, commandId }): [string, string][] =>
          requestId === undefined ? [] : [[requestId, commandId ?? id]],
      ),
      ...get(pendingAtom).prompts.map(
        ({ requestId, commandId }): [string, string] => [requestId, commandId],
      ),
    ]);
    for (const candidate of get(rawAdmissionsAtom)) {
      const commandId = observedRequests.get(candidate.requestId);
      if (commandId !== undefined) {
        set(promptRequestIdsAtom, (current) =>
          new Map(current).set(commandId, candidate.requestId),
        );
      }
    }
    set(rawAdmissionsAtom, (current) => {
      const unresolved = current.filter(
        ({ requestId, status, commandId }) =>
          !observedRequests.has(requestId) &&
          (status !== "accepted" ||
            commandId === undefined ||
            !knownCommandIds.has(commandId)),
      );
      if (unresolved.length !== current.length) {
        try {
          set(persistAtom, { admissions: unresolved });
        } catch (cause) {
          reportFailure("save reconciled draft", cause);
        }
      }
      return unresolved.length === current.length ? current : unresolved;
    });
  });
  const admissionErrorAtom = atom<"queue_full" | undefined>(undefined);
  const setDraftAtom = atom(null, (get, set, value: string) => {
    try {
      set(persistAtom, { draft: value });
    } catch (cause) {
      reportFailure("save current draft", cause);
      interactions.toast({
        variant: "error",
        message: `Draft not saved: ${errorMessage(cause)}`,
      });
    }
    if (get(draftAtom) !== value)
      set(draftRevisionAtom, (revision) => revision + 1);
    set(draftAtom, value);
    set(admissionErrorAtom, undefined);
  });
  /** Consume only the exact draft a command submitted. */
  const clearSubmittedDraftAtom = atom(
    null,
    (get, set, submitted: Readonly<{ draft: string; revision: number }>) => {
      if (
        get(draftRevisionAtom) !== submitted.revision ||
        get(draftAtom) !== submitted.draft
      )
        return;
      set(persistAtom, { draft: "" });
      set(draftAtom, "");
    },
  );
  const abortAtom = atomWithMutation(
    () => ({
      mutationFn: (commandId: string) =>
        session.command({ type: "cancel", commandId }),
    }),
    () => queryClient,
  );

  // One unresolved queued gesture per mounted conversation, like Recall.
  // Accepted masks last only while that identity remains in the bounded owner
  // pending page; stale pre-ack snapshots cannot resurrect the removed row.
  let queuedCancellation: Promise<void> | undefined;
  const cancelQueuedAtom = atom(
    null,
    (get, set, commandId: string): Promise<void> => {
      if (!mounted || get(recallStateAtom).kind === "recalling")
        return Promise.resolve();
      if (queuedCancellation !== undefined) return queuedCancellation;
      if (
        get(hiddenQueuedAtom).has(commandId) ||
        !get(pendingAtom).prompts.some(
          (prompt) => prompt.commandId === commandId,
        )
      )
        return Promise.resolve();
      set(hiddenQueuedAtom, new Set(get(hiddenQueuedAtom)).add(commandId));
      set(cancellingQueuedAtom, commandId);
      const reveal = () => {
        const next = new Set(get(hiddenQueuedAtom));
        next.delete(commandId);
        set(hiddenQueuedAtom, next);
      };
      const operation = Promise.resolve()
        .then(() =>
          session.command({ type: "cancel", commandId, onlyIfPending: true }),
        )
        .then(
          (result) => {
            if (!mounted) return;
            if (result.status === "too_late") {
              reveal();
              interactions.toast({
                variant: "warning",
                message:
                  "Couldn't remove that message: it is no longer pending.",
              });
            }
          },
          () => {
            if (!mounted) return;
            reveal();
            interactions.toast({
              variant: "warning",
              message:
                "Cancellation unconfirmed. That message may still run. Try again or reconnect.",
            });
          },
        )
        .finally(() => {
          queuedCancellation = undefined;
          if (!mounted) return;
          set(cancellingQueuedAtom, undefined);
          set(reconcileQueuedCancellationAtom);
        });
      queuedCancellation = operation;
      return operation;
    },
  );

  const tailAtom = atom((get) => {
    if (get(hasNewerHistoryAtom)) return [];
    const snapshot = get(snapshotAtom);
    const pending = get(visiblePendingAtom);
    return buildTimelineTail(
      get(durableAtom),
      snapshot?.progress ?? null,
      pending.prompts,
      get(admissionsAtom),
      authorOf,
    );
  });
  const timelineAtom = atom<
    Omit<
      TimelineController,
      | "loadOlderHistory"
      | "loadNewerHistory"
      | "jumpToLatest"
      | "pinVisibleHistory"
      | "cancelQueued"
    >
  >((get) => {
    const durable = get(durableAtom);
    const base = {
      pendingHasMore: get(pendingAtom).hasMore,
      queued: get(visiblePendingAtom),
      cancellingQueued:
        get(cancellingQueuedAtom) !== undefined ||
        get(recallStateAtom).kind === "recalling",
      positionAnchors: durable.positionAnchors,
      commandAnchors: durable.commandAnchors,
      hasMoreHistory: get(hasMoreHistoryAtom),
      hasNewerHistory: get(hasNewerHistoryAtom),
      loadingOlderHistory: get(loadingOlderHistoryAtom),
      settled: durable.items,
      tail: get(tailAtom),
    };
    return durable.model === undefined || durable.usage === undefined
      ? base
      : { ...base, model: durable.model, usage: durable.usage };
  });

  const failureAtom = atom<ComposerController["failure"]>((get) => {
    const admissions = get(admissionsAtom);
    const snapshot = get(snapshotAtom);
    const pending = get(pendingAtom);
    const latestSubmission = get(rawAdmissionsAtom).find(
      ({ requestId }) => requestId === get(latestSubmissionIdAtom),
    );
    const promptPending =
      pending.prompts.length > 0 ||
      admissions.some(({ status }) => status !== "failed");
    if (
      latestSubmission?.status === "failed" &&
      snapshot !== undefined &&
      sessionActivityStatus(sessionViewState(snapshot)) === "idle" &&
      !promptPending
    )
      return "admission";
    if (
      latestSubmission?.status === "admitting" ||
      (latestSubmission?.status === "accepted" &&
        !get(durableAtom).commandIds.has(latestSubmission.commandId ?? "") &&
        !pending.prompts.some(
          ({ commandId }) => commandId === latestSubmission.commandId,
        ) &&
        !snapshot?.terminals.some(
          ({ commandId }) => commandId === latestSubmission.commandId,
        ))
    )
      return undefined;
    if (promptPending) return undefined;
    const newestCommandId = get(newestCommandAtom);
    const outcome = snapshot?.terminals.find(
      ({ commandId }) => commandId === newestCommandId,
    )?.outcome;
    return outcome === "completed" ? undefined : outcome;
  });
  const observationAtom = atom<ParakeetObservation>((get) => {
    const query = get(queryAtom);
    if (query.isError)
      return {
        status: "unavailable",
        reason:
          query.error instanceof Error && query.error.message.trim().length > 0
            ? query.error.message
            : "Session history is unavailable",
      };
    return query.data?.observation === "live" ? live : connecting;
  });
  const statusAtom = atom((get) => {
    if (get(observationAtom).status === "unavailable") return "disconnected";
    if (get(observationAtom).status === "connecting") return "connecting";
    return composerStatus(
      get(snapshotAtom),
      get(admissionsAtom),
      get(failureAtom),
    );
  });
  const contextAtom = atom(
    (get): SessionContext | undefined => get(snapshotAtom)?.context,
  );
  const commandIdAtom = atom((get) => {
    const queue = get(snapshotAtom)?.activity.queue;
    return queue?.state === "idle" ? undefined : queue?.commandId;
  });
  let ownerView: SessionViewState | undefined;
  const viewStateAtom = atom((get): ParakeetSessionViewState => {
    const observation = get(observationAtom);
    if (observation.status === "unavailable")
      return { kind: "disconnected", cause: observation.reason };
    if (observation.status === "connecting") return { kind: "connecting" };
    if (get(failureAtom) === "admission") {
      const failed = [...get(rawAdmissionsAtom)]
        .reverse()
        .find((admission) => admission.status === "failed");
      return {
        kind: "error",
        cause: (failed?.error ?? "Prompt admission failed").slice(0, 200),
      };
    }
    const snapshot = get(snapshotAtom);
    if (snapshot === undefined) return { kind: "connecting" };
    const next = sessionViewState(snapshot);
    // Keep the readout stable while its meaning is unchanged.
    if (ownerView !== undefined && sameSessionViewState(ownerView, next))
      return ownerView;
    ownerView = next;
    return next;
  });

  const dispatchAdmissionAtom = atom(
    null,
    (
      get,
      set,
      {
        admission,
        consumeDraft,
      }: Readonly<{
        admission: SubmittedPromptAdmission;
        consumeDraft: boolean;
      }>,
    ) => {
      try {
        set(
          persistAtom,
          consumeDraft
            ? { draft: "", draftPayload: {} }
            : { draft: get(draftAtom) },
        );
      } catch (cause) {
        reportFailure("save pending draft before send", cause);
        set(rawAdmissionsAtom, (current) =>
          current.filter(({ requestId }) => requestId !== admission.requestId),
        );
        interactions.toast({
          variant: "error",
          message: `Not sent: ${errorMessage(cause)}`,
        });
        return;
      }
      if (consumeDraft) {
        set(draftImagesAtom, undefined);
        set(draftDeliveryAtom, undefined);
        set(setDraftAtom, "");
      }
      const prompt: PromptCommand = {
        type: "prompt",
        text: admission.content,
        requestId: admission.requestId,
        delivery: admission.delivery,
      };
      void session
        .command(
          admission.images === undefined
            ? prompt
            : { ...prompt, images: admission.images },
        )
        .then((accepted) => {
          if (
            !mounted ||
            !get(rawAdmissionsAtom).some(
              ({ requestId, status }) =>
                requestId === admission.requestId && status === "admitting",
            )
          )
            return;
          if (accepted.status === "recorded") {
            set(rawAdmissionsAtom, (current) =>
              current.filter(
                (candidate) => candidate.requestId !== admission.requestId,
              ),
            );
            set(persistAtom);
            return;
          }
          set(promptRequestIdsAtom, (current) =>
            new Map(current).set(accepted.commandId, admission.requestId),
          );
          set(rawAdmissionsAtom, (current) =>
            current.map((candidate) =>
              candidate.requestId === admission.requestId
                ? {
                    requestId: candidate.requestId,
                    content: candidate.content,
                    images: candidate.images,
                    submittedDraft: candidate.submittedDraft,
                    restoreDraft: candidate.restoreDraft,
                    delivery: candidate.delivery,
                    commandId: accepted.commandId,
                    status: "accepted",
                  }
                : candidate,
            ),
          );
          set(reconcileAdmissionsAtom);
          set(persistAtom);
        })
        .catch((cause: unknown) => {
          if (!mounted) return;
          recoveryReasons.set(admission.requestId, errorMessage(cause));
          set(recoverAdmissionsAtom);
        });
    },
  );
  const recoverAdmissionsAtom = atom(null, (get, set) => {
    if (!mounted) return;
    for (const admission of get(rawAdmissionsAtom)) {
      const reason = recoveryReasons.get(admission.requestId);
      if (
        admission.status !== "admitting" ||
        reason === undefined ||
        recovering.has(admission.requestId)
      )
        continue;
      recovering.add(admission.requestId);
      void boundWithdrawal(session.withdraw(admission.requestId))
        .then((resolution) => {
          if (
            !mounted ||
            !get(rawAdmissionsAtom).some(
              ({ requestId, status }) =>
                requestId === admission.requestId && status === "admitting",
            )
          )
            return;
          if (resolution.status === "accepted") {
            set(promptRequestIdsAtom, (current) =>
              new Map(current).set(resolution.commandId, admission.requestId),
            );
            set(rawAdmissionsAtom, (current) =>
              current.map((candidate) =>
                candidate.requestId === admission.requestId
                  ? {
                      ...candidate,
                      status: "accepted",
                      commandId: resolution.commandId,
                    }
                  : candidate,
              ),
            );
            set(persistAtom);
            set(reconcileAdmissionsAtom);
            return;
          }
          const currentDraft = get(draftAtom);
          const restored = !admission.restoreDraft
            ? currentDraft
            : currentDraft === ""
              ? admission.submittedDraft
              : `${currentDraft}\n\n${admission.submittedDraft}`;
          const failed = get(rawAdmissionsAtom).map(
            (candidate): SubmittedPromptAdmission =>
              candidate.requestId === admission.requestId
                ? { ...candidate, status: "failed", error: reason }
                : candidate,
          );
          // Commit restoration and removal of the pending record in ONE replacement.
          const restoredImages = admission.restoreDraft
            ? [...(get(draftImagesAtom) ?? []), ...(admission.images ?? [])]
            : get(draftImagesAtom);
          set(persistAtom, {
            draft: restored,
            draftPayload: {
              images: restoredImages,
              delivery: get(draftDeliveryAtom),
            },
            admissions: failed,
          });
          set(draftImagesAtom, restoredImages);
          set(rawAdmissionsAtom, failed);
          set(setDraftAtom, restored);
          interactions.toast({
            variant: "error",
            message: `Not sent: ${reason}`,
          });
        })
        .catch((cause: unknown) => {
          if (mounted)
            interactions.toast({
              variant: "error",
              message: `Send outcome unconfirmed; draft saved: ${errorMessage(cause)}`,
            });
        })
        .finally(() => {
          recovering.delete(admission.requestId);
        });
    }
  });
  const maintainRecoveryAtom = atom(null, (get, set) => {
    const observation = get(observationAtom).status;
    const admissions = get(rawAdmissionsAtom);
    for (const [id, timer] of timers) {
      if (
        !admissions.some(
          ({ requestId, status }) => requestId === id && status === "admitting",
        )
      ) {
        clearTimeout(timer);
        timers.delete(id);
        recoveryReasons.delete(id);
      }
    }
    for (const admission of admissions) {
      if (admission.status !== "admitting") continue;
      if (observation === "unavailable")
        recoveryReasons.set(admission.requestId, "Disconnected");
      if (!timers.has(admission.requestId)) {
        timers.set(
          admission.requestId,
          setTimeout(() => {
            recoveryReasons.set(
              admission.requestId,
              "Send confirmation timed out",
            );
            set(recoverAdmissionsAtom);
          }, 30_000),
        );
      }
    }
    if (observation === "live" || observation === "unavailable")
      set(recoverAdmissionsAtom);
  });
  const mountRecoveryAtom = atom(null, (_get, set) => {
    mounted = true;
    set(recallStateAtom, { kind: "idle" });
    set(maintainRecoveryAtom);
    return () => {
      mounted = false;
      recallOwner?.dispose();
      recallOwner = undefined;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  });
  const sendAtom = atom(
    null,
    (get, set, delivery: PromptDelivery = "steer") => {
      const draft = get(draftAtom);
      const content = draft;
      if (get(recallStateAtom).kind === "recalling") return;
      if (content.trim() === "" && (get(draftImagesAtom)?.length ?? 0) === 0)
        return;
      const admissions = get(admissionsAtom);
      const unresolved = admissions.filter(({ status }) => status !== "failed");
      if (unresolved.length >= MAX_UNRESOLVED_LOCAL_ADMISSIONS) {
        set(admissionErrorAtom, "queue_full");
        return;
      }
      const admission: SubmittedPromptAdmission = {
        content,
        delivery: get(draftDeliveryAtom) ?? delivery,
        images: get(draftImagesAtom),
        requestId: nanoid(),
        submittedDraft: draft,
        restoreDraft: true,
        status: "admitting",
      };
      set(rawAdmissionsAtom, [...admissions, admission]);
      set(latestSubmissionIdAtom, admission.requestId);
      set(admissionErrorAtom, undefined);
      set(dispatchAdmissionAtom, { admission, consumeDraft: true });
    },
  );
  const submitCommandAtom = atom(
    null,
    async (
      get,
      set,
      run: (
        draft: string,
        consumeDraft: () => void,
      ) => Promise<WhistleExecutionOutcome | undefined>,
    ): Promise<WhistleExecutionOutcome | undefined> => {
      const submitted = {
        draft: get(draftAtom),
        revision: get(draftRevisionAtom),
      };
      const outcome = await run(submitted.draft, () => {
        set(clearSubmittedDraftAtom, submitted);
      });
      if (outcome?.status === "handled" && !isCancelledOutcome(outcome))
        set(clearSubmittedDraftAtom, submitted);
      return outcome;
    },
  );
  const retryAtom = atom(null, (get, set) => {
    const admissions = get(admissionsAtom);
    if (get(failureAtom) === "interrupted" || get(failureAtom) === "failed") {
      const snapshot = get(snapshotAtom);
      const commandId = get(newestCommandAtom);
      const prompt = get(queryAtom).data?.latestPrompt;
      if (
        snapshot === undefined ||
        prompt === undefined ||
        prompt.commandId !== commandId
      )
        return;
      const content = prompt.text;
      // Equal text alone does not make a newer image draft the failed prompt.
      const consumeDraft =
        get(draftAtom) === content &&
        sameImageCargo(get(draftImagesAtom), prompt.images);
      if (
        admissions.filter(({ status }) => status !== "failed").length >=
        MAX_UNRESOLVED_LOCAL_ADMISSIONS
      ) {
        set(admissionErrorAtom, "queue_full");
        return;
      }
      const retry: SubmittedPromptAdmission = {
        content,
        images: prompt.images,
        delivery: "followUp",
        requestId: nanoid(),
        submittedDraft: content,
        restoreDraft: consumeDraft,
        status: "admitting",
      };
      set(rawAdmissionsAtom, [...get(rawAdmissionsAtom), retry]);
      set(latestSubmissionIdAtom, retry.requestId);
      set(admissionErrorAtom, undefined);
      set(dispatchAdmissionAtom, {
        admission: retry,
        consumeDraft,
      });
      return;
    }
    const admission = admissions
      .filter((candidate) => candidate.status === "failed")
      .at(-1);
    if (admission === undefined) return;
    if (
      admissions.filter(({ status }) => status !== "failed").length >=
      MAX_UNRESOLVED_LOCAL_ADMISSIONS
    ) {
      set(admissionErrorAtom, "queue_full");
      return;
    }
    const consumeDraft =
      get(draftAtom) === admission.submittedDraft &&
      sameImageCargo(get(draftImagesAtom), admission.images);
    const retry: SubmittedPromptAdmission = {
      content: admission.content,
      delivery: admission.delivery,
      images: admission.images,
      requestId: nanoid(),
      submittedDraft: admission.submittedDraft,
      restoreDraft: consumeDraft,
      status: "admitting",
    };
    set(rawAdmissionsAtom, (current) =>
      current.map((candidate) =>
        candidate.requestId === admission.requestId ? retry : candidate,
      ),
    );
    set(latestSubmissionIdAtom, retry.requestId);
    set(admissionErrorAtom, undefined);
    set(dispatchAdmissionAtom, {
      admission: retry,
      consumeDraft,
    });
  });
  const dismissFailedAtom = atom(null, (get, set, requestId: string) => {
    const admissions = get(rawAdmissionsAtom);
    const remaining = admissions.filter(
      (admission) =>
        admission.requestId !== requestId || admission.status !== "failed",
    );
    if (remaining.length === admissions.length) return;
    set(rawAdmissionsAtom, remaining);
    if (get(latestSubmissionIdAtom) === requestId)
      set(latestSubmissionIdAtom, remaining.at(-1)?.requestId);
  });
  let cancellation: Promise<void> | undefined;
  const cancelAtom = atom(null, (get): Promise<void> => {
    if (cancellation !== undefined) return cancellation;
    const queue = get(snapshotAtom)?.activity.queue;
    if (queue?.state !== "running") return Promise.resolve();
    const operation = get(abortAtom)
      .mutateAsync(queue.commandId)
      .then(() => undefined);
    const tracked = operation.finally(() => {
      if (cancellation === tracked) cancellation = undefined;
    });
    cancellation = tracked;
    return tracked;
  });
  let reconnecting: Promise<ParakeetReconnectOutcome> | undefined;
  const reconnectAtom = atom(null, (get): Promise<ParakeetReconnectOutcome> => {
    const observation = get(observationAtom);
    if (observation.status !== "unavailable")
      return Promise.resolve({
        kind: "nothing_to_reconnect",
        state: observation.status === "live" ? "connected" : "connecting",
      });
    if (reconnecting !== undefined) return reconnecting;
    const query = queryClient.getQueryCache().find({
      queryKey: sessionQueryOptions(session).queryKey,
    });
    if (query === undefined)
      return Promise.resolve({
        kind: "failed",
        cause: "Session observation is unavailable",
      });
    const priorData = query.state.dataUpdateCount;
    const priorError = query.state.errorUpdateCount;
    const retry = new Promise<ParakeetReconnectOutcome>((resolve) => {
      let unsubscribe: () => void = () => undefined;
      let settled = false;
      const finish = (outcome: ParakeetReconnectOutcome) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        clearTimeout(timeout);
        resolve(outcome);
      };
      const inspect = () => {
        if (
          query.state.dataUpdateCount > priorData &&
          queryClient.getQueryData(sessionQueryOptions(session).queryKey)
            ?.observation === "live"
        ) {
          finish({ kind: "reconnected" });
          return;
        }
        if (query.state.errorUpdateCount > priorError)
          finish({
            kind: "failed",
            cause: observationCause(query.state.error),
          });
      };
      unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (event.query === query) inspect();
      });
      const timeout = setTimeout(() => {
        // Streamed "opening" updates also replace TanStack's revert state.
        // Cancel first, then record this real timeout on the existing query
        // without replacing its last coherent snapshot.
        void query.cancel({ revert: true }).then(() => {
          const cause = "Session history did not reopen within 10 seconds";
          query.setState({ status: "error", error: new Error(cause) });
          finish({
            kind: "failed",
            cause,
          });
        });
      }, 10_000);
      // A live stream does not settle its refetch promise until the watch closes.
      // The first new snapshot above is the reconnect acknowledgment.
      void get(queryAtom)
        .refetch({ cancelRefetch: true })
        .catch((cause: unknown) => {
          finish({ kind: "failed", cause: observationCause(cause) });
        });
      inspect();
    });
    reconnecting = retry.finally(() => {
      reconnecting = undefined;
    });
    return reconnecting;
  });

  return {
    cancelQueuedAtom,
    reconcileQueuedCancellationAtom,
    abortAtom,
    draftImagesAtom,
    recallStateAtom,
    recallAtom,
    commandIdAtom,
    contextAtom,
    admissionErrorAtom,
    admissionsAtom,
    cancelAtom,
    checkpointDraftAtom,
    draftAtom,
    dismissFailedAtom,
    extensionsAtom,
    failureAtom,
    jumpToLatestAtom,
    loadOlderHistoryAtom,
    loadNewerHistoryAtom,
    observationAtom,
    observedCommandIdsAtom,
    rawAdmissionsAtom,
    maintainRecoveryAtom,
    mountRecoveryAtom,
    pinVisibleHistoryAtom,
    queryAtom,
    reconcileAdmissionsAtom,
    reconnectAtom,
    retryAtom,
    setDraftAtom,
    sendAtom,
    snapshotAtom,
    statusAtom,
    viewStateAtom,
    submitCommandAtom,
    timelineAtom,
  };
}

type ConversationAtoms = ReturnType<typeof createConversationAtoms>;
type ConversationScope = Readonly<{
  atoms: ConversationAtoms;
  session: ParakeetSession;
  store: ReturnType<typeof createStore>;
  contributions: PrimitiveAtom<readonly ClientContribution[]>;
  interactions: ParakeetInteractions;
  /** One visibility policy shared by timeline rows and their fixed anchors. */
  shown: (item: TimelineItem) => boolean;
}>;
const ConversationContext = createContext<ConversationScope | null>(null);

function useConversationScope(): ConversationScope {
  const scope = useContext(ConversationContext);
  if (scope === null)
    throw new Error("Parakeet hooks require a ParakeetProvider");
  return scope;
}

function useStoreAtom<Value>(atom: Atom<Value>): Value {
  const { store } = useConversationScope();
  const subscribe = useCallback(
    (listener: () => void) => store.sub(atom, listener),
    [atom, store],
  );
  const snapshot = useCallback(() => store.get(atom), [atom, store]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useStoreSetter<Args extends unknown[], Result>(
  atom: WritableAtom<unknown, Args, Result>,
): (...args: Args) => Result {
  const { store } = useConversationScope();
  return useCallback(
    (...args: Args) => store.set(atom, ...args),
    [atom, store],
  );
}

/** Own one renderer-neutral conversation scope over the existing query cache. */
export function ParakeetProvider({
  children,
  session,
  clients = noClients,
  interactionStore,
  authorOf = noAuthor,
  onToast,
  draftStorage,
  draftIdentity,
}: Readonly<{
  children: ReactNode;
  session: ParakeetSession;
  clients?: readonly ClientEntryV1[] | undefined;
  interactionStore?: ParakeetInteractions | undefined;
  /** Show a transient message; the host owns the toast surface. */
  onToast?: ((toast: ParakeetToast) => void) | undefined;
  /**
   * Browser localStorage when accessible, otherwise session-only drafts.
   * Native hosts supply an atomic file adapter.
   */
  draftStorage?: ParakeetDraftStorage | undefined;
  /**
   * Hosts replacing transport endpoints must supply the durable owner pair.
   * Otherwise the Session's logical address names its journal.
   * Exactly one key is used; no previous-address lookup or migration occurs.
   */
  draftIdentity?: ParakeetDraftIdentity | undefined;
  /**
   * Read the author to show from a message's opaque host metadata. Absent,
   * lines show no author.
   */
  authorOf?: ParakeetAuthorOf | undefined;
}>) {
  const queryClient = useQueryClient();
  const acquiredDraftStorage = useMemo(
    () => acquireDraftStorage(draftStorage),
    [draftStorage],
  );
  const draftScope =
    draftIdentity === undefined
      ? session.address
      : JSON.stringify([draftIdentity.agentId, draftIdentity.sessionId]);
  const footerPromptOwners = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        clients
          .filter((entry) => entry.promptPresentation === "footer")
          .map((entry) => entry.id),
      ),
    [clients],
  );
  const scope = useMemo(() => {
    const interactions = interactionStore ?? createParakeetInteractions();
    const contributions = atom(noContributions);
    const shown = (item: TimelineItem) =>
      item.kind !== "user_message" ||
      item.origin === undefined ||
      !footerPromptOwners.has(item.origin.extensionId);
    return {
      atoms: createConversationAtoms(
        session,
        queryClient,
        authorOf,
        interactions,
        acquiredDraftStorage,
        draftScope,
        contributions,
        shown,
      ),
      session,
      store: createStore(),
      contributions,
      interactions,
      shown,
    };
  }, [
    queryClient,
    session,
    interactionStore,
    authorOf,
    footerPromptOwners,
    acquiredDraftStorage,
    draftScope,
  ]);
  useEffect(() => {
    const update = () => {
      scope.store.set(scope.atoms.maintainRecoveryAtom);
    };
    const unobserve = scope.store.sub(scope.atoms.observationAtom, update);
    const unobserveAdmissions = scope.store.sub(
      scope.atoms.rawAdmissionsAtom,
      update,
    );
    const dispose = scope.store.set(scope.atoms.mountRecoveryAtom);
    return () => {
      dispose();
      unobserve();
      unobserveAdmissions();
    };
  }, [scope]);
  useEffect(() => {
    if (onToast === undefined) return undefined;
    return scope.interactions.subscribeToasts(onToast);
  }, [scope, onToast]);
  useEffect(() => {
    if (acquiredDraftStorage.status === "unavailable")
      scope.interactions.report({
        tone: "info",
        message:
          "Drafts are session-only because browser storage is unavailable. They will be lost when this conversation closes.",
      });
  }, [scope, acquiredDraftStorage]);
  useEffect(() => {
    const reconcile = () => {
      scope.store.set(scope.atoms.reconcileQueuedCancellationAtom);
    };
    const unsubscribe = scope.store.sub(scope.atoms.snapshotAtom, reconcile);
    reconcile();
    return unsubscribe;
  }, [scope]);
  useEffect(() => {
    // The live page is bounded: after a later reset an observed command may no
    // longer be present. Retire its local row once, not just while it is visible.
    const reconcile = () => {
      scope.store.set(scope.atoms.reconcileAdmissionsAtom);
    };
    const unobserve = scope.store.sub(
      scope.atoms.observedCommandIdsAtom,
      reconcile,
    );
    reconcile();
    return () => {
      unobserve();
    };
  }, [scope]);
  useEffect(() => {
    const owner = createClientContributions(clients, (entryId, error) => {
      reportFailure(`client contribution ${entryId}`, error);
      scope.interactions.report({ tone: "error", message: error.message });
    });
    const publish = () => {
      scope.store.set(scope.contributions, owner.snapshot());
    };
    const unsubscribe = owner.subscribe(publish);
    const update = () => {
      owner.update(scope.store.get(scope.atoms.extensionsAtom));
    };
    const unobserve = scope.store.sub(scope.atoms.extensionsAtom, update);
    update();
    return () => {
      unobserve();
      owner.dispose();
      unsubscribe();
    };
  }, [clients, scope]);
  return (
    <ConversationContext.Provider value={scope}>
      {children}
    </ConversationContext.Provider>
  );
}

/** Read stable history and replaceable live work. */
export function useTimeline(): TimelineController {
  const { atoms } = useConversationScope();
  const base = useStoreAtom(atoms.timelineAtom);
  const loadOlderHistory = useStoreSetter(atoms.loadOlderHistoryAtom);
  const loadNewerHistory = useStoreSetter(atoms.loadNewerHistoryAtom);
  const jumpToLatest = useStoreSetter(atoms.jumpToLatestAtom);
  const pinVisibleHistory = useStoreSetter(atoms.pinVisibleHistoryAtom);
  const cancelQueued = useStoreSetter(atoms.cancelQueuedAtom);
  const { shown } = useConversationScope();
  // View-only: stored prompts, queue counts and fork stay as loaded.
  const settled = useMemo(
    () => base.settled.filter(shown),
    [base.settled, shown],
  );
  const tail = useMemo(() => base.tail.filter(shown), [base.tail, shown]);
  const view = useMemo(
    () => ({ ...base, settled, tail }),
    [base, settled, tail],
  );
  const hidingOnly =
    view.settled.length + view.tail.length === 0 &&
    base.settled.length + base.tail.length > 0;
  const needsOlder =
    hidingOnly && base.hasMoreHistory && !base.loadingOlderHistory;
  // One automatic request per loaded page: a failed fetch leaves the page
  // unchanged, so it is not retried until the reader scrolls up.
  const pageKey = `${base.settled[0]?.id ?? ""}:${String(base.settled.length)}`;
  const requestedPage = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!needsOlder || requestedPage.current === pageKey) return;
    requestedPage.current = pageKey;
    loadOlderHistory();
  }, [needsOlder, pageKey, loadOlderHistory]);
  return useMemo(
    () => ({
      ...view,
      cancelQueued,
      jumpToLatest,
      loadNewerHistory,
      loadOlderHistory,
      pinVisibleHistory,
    }),
    [
      view,
      cancelQueued,
      jumpToLatest,
      loadNewerHistory,
      loadOlderHistory,
      pinVisibleHistory,
    ],
  );
}

/** Read and mutate the current conversation draft and prompt. */
export function useComposer(): ComposerController {
  const { atoms } = useConversationScope();
  const draft = useStoreAtom(atoms.draftAtom);
  const images = useStoreAtom(atoms.draftImagesAtom);
  const recallState = useStoreAtom(atoms.recallStateAtom);
  const recall = useStoreSetter(atoms.recallAtom);
  const failure = useStoreAtom(atoms.failureAtom);
  const admissionError = useStoreAtom(atoms.admissionErrorAtom);
  const setDraft = useStoreSetter(atoms.setDraftAtom);
  const checkpointDraft = useStoreSetter(atoms.checkpointDraftAtom);
  const send = useStoreSetter(atoms.sendAtom);
  const submitCommand = useStoreSetter(atoms.submitCommandAtom);
  const retry = useStoreSetter(atoms.retryAtom);
  const retryLatest = useCallback(() => {
    retry();
  }, [retry]);
  const dismissFailed = useStoreSetter(atoms.dismissFailedAtom);
  const cancel = useStoreSetter(atoms.cancelAtom);
  return useMemo(
    () => ({
      admissionError,
      cancel,
      checkpointDraft,
      draft,
      images,
      recall,
      recallState,
      dismissFailed,
      failure,
      retry: retryLatest,
      send,
      setDraft,
      submitCommand,
    }),
    [
      admissionError,
      cancel,
      checkpointDraft,
      draft,
      images,
      recall,
      recallState,
      dismissFailed,
      failure,
      retryLatest,
      send,
      setDraft,
      submitCommand,
    ],
  );
}

/** Dismiss a failed prompt without subscribing the timeline to composer edits. */
export function useDismissFailedPrompt(): (requestId: string) => void {
  const { atoms } = useConversationScope();
  return useStoreSetter(atoms.dismissFailedAtom);
}

/** The Session this conversation observes. */
export function useParakeetSession(): ParakeetSession {
  return useConversationScope().session;
}

/** Read the Session's extension slots, including advertised command catalogs. */
export function useExtensionSlots(): SessionExtensionSlots {
  return useStoreAtom(useConversationScope().atoms.extensionsAtom);
}

/** Read Session activity and operate its observation. */
export function useStatus(): StatusController {
  const { atoms } = useConversationScope();
  const commandId = useStoreAtom(atoms.commandIdAtom);
  const status = useStoreAtom(atoms.statusAtom);
  const viewState = useStoreAtom(atoms.viewStateAtom);
  const observation = useStoreAtom(atoms.observationAtom);
  const reconnect = useStoreSetter(atoms.reconnectAtom);
  const context = useStoreAtom(atoms.contextAtom);
  return useMemo(
    () => ({
      commandId,
      context,
      observation,
      reconnect,
      status,
      viewState,
    }),
    [commandId, context, observation, reconnect, status, viewState],
  );
}

/** Presentation admitted once from the selected Session's already observed slots. */
export function useClientContributions(): readonly ClientContribution[] {
  return useStoreAtom(useConversationScope().contributions);
}

/** The selected Session's ordinary command interaction owner. */
export function useParakeetInteractions(): ParakeetInteractions {
  return useConversationScope().interactions;
}
