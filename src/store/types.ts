import type { ParakeetAuthor } from "../core/author-labels.js";
import type {
  PromptDelivery,
  PromptCommand,
  SessionCompactionTrigger,
  SessionMessage,
} from "@fungi.computer/shiitake/client";

import type { ToolArguments } from "../core/tool-contract.js";
import type { ToolCallView } from "../core/tool-view.js";

/** Exact Pi tool result joined to its tool call by the timeline projection. */
export type ToolResultMessage = Extract<
  SessionMessage["value"],
  { role: "toolResult" }
>;

/** One user prompt projected into the conversation timeline. */
export type UserMessageItem = Readonly<{
  /** The author the host read from the message metadata, apart from its text. */
  author?: ParakeetAuthor | undefined;
  /** Durable extension producer, separate from host author attribution. */
  origin?: SessionMessage["origin"];
  /** Stable rendered-item identity. */
  id: string;
  /** User-message timeline discriminator. */
  kind: "user_message";
  /**
   * Client identity of a prompt this composer submitted. It stays the same from
   * submit through queued to durable, so renderers key the row by it; it also
   * names a failed admission to retry or dismiss.
   */
  requestId?: string;
  /** Owner-issued work identity once the prompt is admitted. */
  commandId?: string;
  /**
   * Whether admission is pending/accepted, the owner reports queued, or it
   * failed/settled. Only `confirmed` means the Agent has taken the prompt.
   */
  status: "pending" | "accepted" | "queued" | "failed" | "confirmed";
  /** Delivery intent while this accepted input waits for consumption. */
  delivery?: PromptDelivery;
  /** Admission failure presented by the headless composer. */
  error?: string;
  /** When the prompt was sent, in milliseconds since the epoch, once known. */
  at?: number;
  /** Prompt text. */
  text: string;
}>;

/** One locally submitted prompt before the Session projection catches up. */
export type LocalPromptAdmission = Readonly<{
  /** Caller idempotency key, retained across retries. */
  requestId: string;
  /** Owner-issued identity after successful admission. */
  commandId?: string;
  /** Prompt content sent to the Session. */
  content: string;
  /** Full image payload retained with an optimistic or recalled prompt. */
  images?: PromptCommand["images"];
  /** Existing Session delivery intent. */
  delivery: PromptDelivery;
  /** Current local admission result. */
  status: "queued-local" | "admitting" | "accepted" | "failed";
  /** User-presentable admission error when status is failed. */
  error?: string;
}>;

/** One assistant message projected from exact stored Pi content. */
export type AssistantMessageItem = Readonly<{
  /** The author of a human reply carried as assistant text, as the host read it. */
  author?: ParakeetAuthor | undefined;
  /** Stable rendered-item identity. */
  id: string;
  /** Assistant-message timeline discriminator. */
  kind: "assistant_message";
  /** Whether the assistant message terminated with an error. */
  isError?: boolean;
  /** Whether replaceable progress is still contributing to this message. */
  pending: boolean;
  /** When the reply was written, in milliseconds since the epoch, once known. */
  at?: number;
  /** Assistant-visible response text. */
  text: string;
  /** Pi's private failed-turn error text; never a terminal or delegation diagnostic. */
  providerError?: string;
  /** Short assistant output retained before a provider failure, not provider prose. */
  errorDetail?: string;
  /** Consecutive failures with the same visible headline and detail. */
  repeatCount?: number;
  /** Assistant reasoning text, when supplied by the model. */
  thinking?: string;
  /** Usage carried by the exact assistant message. */
  usage?: Readonly<{
    /** Provider cost of this assistant message. */
    cost: number;
    /** Tokens consumed by this assistant message. */
    tokens: number;
  }>;
}>;

/** One Pi tool call joined with its corresponding tool result. */
export type ToolItem = Readonly<{
  /** Canonically parsed JSON arguments supplied to the tool. */
  args: Readonly<ToolArguments>;
  /** Stable tool-call identity. */
  id: string;
  /** Tool timeline discriminator. */
  kind: "tool";
  /** Pi tool name. */
  name: string;
  /** Exact joined Pi tool result, when one has completed. */
  result?: ToolResultMessage;
  /** Application display payload, separate from the model result. */
  data?: SessionMessage["data"];
  /** Timestamp of the assistant message that issued the call. */
  startedAt?: number;
  /** Owner-confirmed activity or result; unknown when neither is available. */
  status: "completed" | "error" | "running" | "unknown";
}>;

/**
 * One maximal run of consecutive tool calls between conversation rows. A lone
 * call is a group of one. Grouping is computed once by the headless projection.
 */
export type ToolGroupItem = Readonly<{
  /** Running call whose live line the collapsed header shows. */
  active?: ToolCallView | undefined;
  /** Renderer-neutral view of each call, in call order. */
  calls: readonly ToolCallView[];
  /** First call to last result, once no call is running. */
  durationMs?: number | undefined;
  /** Calls whose joined result reports an error. */
  failedCount: number;
  /** Stable identity derived from the first call, kept as calls append. */
  id: string;
  /** Tool-group timeline discriminator. */
  kind: "tool_group";
  /** `running` for owner-confirmed work; unknown when a result is unavailable. */
  status: "completed" | "error" | "running" | "unknown";
  /** One-line summary from typed kinds, e.g. `Read 3 files, ran 2 commands`. */
  summary: string;
  /** Exact joined calls, in call order. */
  tools: readonly ToolItem[];
}>;

/**
 * One compaction boundary rendered as a divider: a full-width rule with a
 * short label, never a chat bubble. Everything above it was summarized away;
 * the agent's live context starts at the row immediately below it.
 * @inline
 */
export type CompactionDividerItem = Readonly<{
  /** Stable rendered-item identity, from the durable compaction entry. */
  id: string;
  /** Compaction-divider timeline discriminator. */
  kind: "compaction_divider";
  /** When the compaction ran, in milliseconds since the epoch. */
  at: number;
  /** Estimated context tokens the compaction started from. */
  tokensBefore: number;
  /** Estimated context tokens right after it; null for older compactions. */
  tokensAfter: number | null;
}>;

/**
 * A compaction that changed nothing, rendered as a short notice at its own
 * place in the timeline: never a chat bubble, never a context edit.
 * @inline
 */
export type CompactionNoticeItem = Readonly<{
  /** Stable rendered-item identity, from the durable notice entry. */
  id: string;
  /** Compaction-notice timeline discriminator. */
  kind: "compaction_notice";
  /** When it was recorded, in milliseconds since the epoch. */
  at: number;
  /** What started it: the user, the context threshold, or an overflow. */
  trigger: SessionCompactionTrigger;
  /** What the compaction did: nothing to summarize, a failure, or a summary
   * dropped because its head no longer fit the context (stale) or because
   * placing it would have left the context over the limit (insufficient). */
  result: "nothing_to_compact" | "failed" | "stale" | "insufficient";
  /** A failure's bounded reason; null otherwise. */
  diagnostic: string | null;
}>;

/** Stable row grammar rendered by Parakeet's timeline. */
export type TimelineItem =
  | AssistantMessageItem
  | CompactionDividerItem
  | CompactionNoticeItem
  | ToolGroupItem
  | UserMessageItem;

/** Projection-internal rows before consecutive calls are grouped. */
export type ProjectedItem =
  | AssistantMessageItem
  | CompactionDividerItem
  | CompactionNoticeItem
  | ToolItem
  | UserMessageItem;
