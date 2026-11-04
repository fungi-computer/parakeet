import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as z from "zod";
import { EventSource } from "eventsource";
import type { ParakeetSession, ParakeetPromptResult } from "./session.js";
import {
  parseAccepted,
  parseWithdrawResult,
  parseLatestPendingPrompt,
  parseSessionSnapshot,
  parseSessionFrame,
  type SessionFrame,
  type SessionSnapshot,
  type ReadOptions,
  type CompactCommand,
  type PromptCommand,
  type CancelCommand,
  type CancelResult,
  type AbortCommand,
  type BranchCommand,
  type OperatorCommand,
  type TitleCommand,
  type ForkCommand,
  type ForkedSession,
  type SessionCommand,
} from "@fungi.computer/shiitake/client";
import { embedStorage } from "./website-storage.js";

const decodeJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);
const credentialsSchema = z.strictObject({
  visitorId: z.string(),
  accessToken: z.string(),
  accessExpiresAt: z.number(),
  refreshSecret: z.string(),
});
type Credentials = z.infer<typeof credentialsSchema>;
const errorSchema = z.strictObject({ error: z.string() });
const refusals = new Map([
  [
    "party_daily_limit",
    "You've reached today's message limit. Please come back tomorrow.",
  ],
  ["new_party_limit", "This chat is busy right now. Please try again shortly."],
  ["address_limit", "This chat is busy right now. Please try again shortly."],
  ["too_long", "That message is too long."],
  ["suspended", "This chat is offline."],
  ["banned", "This chat is not available."],
  ["turnstile_required", "Please finish the security check and try again."],
  ["turnstile_failed", "The security check did not pass. Please try again."],
  [
    "turnstile_unavailable",
    "The security check is unavailable. Try again soon.",
  ],
]);
class EmbedError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(refusals.get(code) ?? "Chat unavailable. Please try again.", options);
  }
}
function readStored(key: string): Credentials | null {
  const raw = embedStorage.read(key);
  if (Result.isFailure(raw) || raw.success === null) return null;
  const json = decodeJson(raw.success);
  if (Option.isNone(json)) return null;
  const parsed = credentialsSchema.safeParse(json.value);
  return parsed.success ? parsed.data : null;
}
async function failure(response: Response): Promise<EmbedError> {
  const decoded = decodeJson(await response.text());
  if (Option.isNone(decoded)) return new EmbedError(String(response.status));
  const body = errorSchema.safeParse(decoded.value);
  return new EmbedError(
    body.success ? body.data.error : String(response.status),
  );
}

/** What a host adds to its visitors' first request. */
export type VisitorClientOptions = Readonly<{
  /** A Turnstile token for a site that requires one; asked only to mint. */
  challenge?: () => Promise<string>;
}>;

/** Only the host's iframe owns this binding's partitioned visitor credentials. */
export function createVisitorClient(
  siteKey: string,
  options: VisitorClientOptions = {},
): ParakeetSession {
  const base = `/api/embed/v1/sites/${siteKey}`;
  const key = `fungi-embed:${siteKey}`;
  let credentials = readStored(key);
  const store = (next: Credentials | null) => {
    credentials = next;
    if (next === null) embedStorage.remove(key);
    else embedStorage.write(key, JSON.stringify(next));
  };
  const issue = async (
    path: "/visitors" | "/visitors/refresh" | "/visitors/rotate",
    body: Readonly<{ refreshSecret?: string; turnstileToken?: string }>,
    authorization?: string,
  ) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (authorization !== undefined)
      headers.set("authorization", `Bearer ${authorization}`);
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    const issued = credentialsSchema.parse(await response.json());
    store(issued);
    return issued;
  };
  const token = async (): Promise<string> => {
    if (
      credentials !== null &&
      credentials.accessExpiresAt - 60_000 > Date.now()
    )
      return credentials.accessToken;
    if (credentials !== null) {
      return (
        await issue("/visitors/refresh", {
          refreshSecret: credentials.refreshSecret,
        })
      ).accessToken;
    }
    const turnstileToken = await options.challenge?.();
    return (
      await issue(
        "/visitors",
        turnstileToken === undefined ? {} : { turnstileToken },
      )
    ).accessToken;
  };
  const authorized = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await token()}`);
    const response = await fetch(`${base}${path}`, { ...init, headers });
    if (!response.ok) throw await failure(response);
    return response;
  };
  const read = async (options?: ReadOptions): Promise<SessionSnapshot> =>
    parseSessionSnapshot(
      await (
        await authorized("/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(options ?? {}),
        })
      ).text(),
    );
  function command(
    input: PromptCommand | CompactCommand,
  ): Promise<ParakeetPromptResult>;
  function command(input: CancelCommand): Promise<CancelResult>;
  function command(
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ): Promise<undefined>;
  function command(input: ForkCommand): Promise<ForkedSession>;
  function command(
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined>;
  async function command(
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined> {
    if (input.type !== "prompt" || (input.images?.length ?? 0) > 0)
      throw new EmbedError("command_not_allowed");
    try {
      const response = await authorized("/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: input.requestId,
          text: input.text,
        }),
      });
      const raw = await response.text();
      const decoded = decodeJson(raw);
      if (Option.isNone(decoded)) throw new EmbedError("invalid_response");
      const recorded = z
        .strictObject({
          status: z.literal("recorded"),
          delivery: z.enum(["new", "replay"]),
        })
        .safeParse(decoded.value);
      return recorded.success ? { status: "recorded" } : parseAccepted(raw);
    } catch (cause) {
      if (cause instanceof EmbedError)
        throw new Error(
          refusals.get(cause.code) ?? "Chat is unavailable. Please try again.",
          { cause },
        );
      throw cause;
    }
  }
  return {
    address: new URL(`${base}/session`, window.location.origin).href,
    command,
    withdraw: async (requestId) =>
      parseWithdrawResult(
        await (
          await authorized("/requests/withdraw", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ requestId }),
          })
        ).text(),
      ),
    latestPending: async () =>
      parseLatestPendingPrompt(
        await (await authorized("/conversation/pending/latest")).text(),
      ),
    extension: () => ({
      call: () => Promise.reject(new EmbedError("command_not_allowed")),
    }),
    read,
    watch: async (options) => {
      const snapshot = await read(options);
      let controller: ReadableStreamDefaultController<SessionFrame> | undefined;
      let closed = false;
      const changes = new ReadableStream<SessionFrame>(
        {
          start: (next) => {
            controller = next;
          },
        },
        { highWaterMark: 32 },
      );
      const source = new EventSource(
        new URL(`${base}/conversation/events`, window.location.origin),
        {
          fetch: async (input, init) => {
            const headers = new Headers(init.headers);
            try {
              headers.set("authorization", `Bearer ${await token()}`);
            } catch (cause) {
              stop(new Error("Chat unavailable. Please try again.", { cause }));
              return new Response("Chat unavailable", { status: 403 });
            }
            return fetch(input, { ...init, headers });
          },
        },
      );
      const stop = (cause: unknown) => {
        if (closed) return;
        closed = true;
        source.close();
        controller?.error(cause);
      };
      source.addEventListener("session", (event) => {
        if (closed) return;
        try {
          const baseline = parseSessionSnapshot(z.string().parse(event.data));
          if (baseline.sessionId !== snapshot.sessionId)
            throw new EmbedError("invalid_response");
          if ((controller?.desiredSize ?? 0) <= 0)
            throw new EmbedError("stream_overflow");
          controller?.enqueue({
            kind: "reset",
            reason: "history_unavailable",
            cursor: baseline.cursor,
            baseline,
          });
        } catch (cause) {
          stop(cause);
        }
      });
      source.addEventListener("frame", (event) => {
        if (closed) return;
        try {
          const frame = parseSessionFrame(z.string().parse(event.data));
          if (
            frame.kind !== "heartbeat" &&
            frame.kind !== "progress" &&
            frame.kind !== "activity"
          )
            throw new EmbedError("invalid_response");
          if ((controller?.desiredSize ?? 0) <= 0)
            throw new EmbedError("stream_overflow");
          controller?.enqueue(frame);
        } catch (cause) {
          stop(cause);
        }
      });
      source.addEventListener("error", () => {
        stop(new Error("Chat unavailable. Please try again."));
      });
      const reader = changes.getReader();
      return {
        snapshot,
        changes: {
          async *[Symbol.asyncIterator]() {
            try {
              for (;;) {
                const next = await reader.read();
                if (next.done) return;
                yield next.value;
              }
            } finally {
              reader.releaseLock();
            }
          },
        },
        close: () => {
          if (!closed) {
            closed = true;
            controller?.close();
          }
          source.close();
          return Promise.resolve();
        },
      };
    },
  };
}
