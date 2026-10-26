import { Sigil } from "@fungi.computer/sigils";
import { Button } from "@fungi.computer/caps/components/button";
import { memo, type ReactNode } from "react";

import {
  disclosureOpen,
  initialToolDisclosure,
  type ToolDisclosureState,
} from "../core/tool-groups.js";
import { assistantMessageVisible } from "../core/assistant-visibility.js";
import { formatTokenCount } from "../core/format-context.js";
import type { TimelineItem as TimelineRow, ToolItem } from "../store/types.js";
import { ChatMessage, PendingMessageStatus } from "./ChatMessage.js";
import { ToolGroup, type ToggleToolDisclosure } from "./ToolGroup.js";

const ignoreToggle: ToggleToolDisclosure = () => undefined;

const compactionNoticeLabel = {
  nothing_to_compact: "nothing to compact",
  failed: "compaction failed",
  stale: "compaction skipped: the context moved on",
  insufficient: "compaction skipped: the summary would not fit",
} as const;

export const TimelineItem = memo(function TimelineItem({
  item,
  onDismissFailed,
  onCancelQueued,
  cancellingQueued = false,
  renderToolActions,
  renderAssistantAttachment,
  formatAssistantText,
  toolDisclosure = initialToolDisclosure,
  onToggleTool = ignoreToggle,
}: Readonly<{
  item: TimelineRow;
  onDismissFailed?: ((requestId: string) => void) | undefined;
  onCancelQueued?: ((commandId: string) => void) | undefined;
  cancellingQueued?: boolean | undefined;
  renderToolActions?: ((item: ToolItem) => ReactNode) | undefined;
  renderAssistantAttachment?: ((text: string) => ReactNode) | undefined;
  formatAssistantText?: ((text: string) => string) | undefined;
  /** View-only open state for tool groups and calls. */
  toolDisclosure?: ToolDisclosureState | undefined;
  /** Flip one tool group or call. */
  onToggleTool?: ToggleToolDisclosure | undefined;
}>) {
  switch (item.kind) {
    case "user_message": {
      const pending = item.status === "pending" || item.status === "queued";
      const requestId = item.requestId;
      const commandId = item.commandId;
      const cancelAction =
        item.status === "queued" &&
        commandId !== undefined &&
        onCancelQueued !== undefined ? (
          <div className="flex justify-end px-3">
            <Button
              aria-label="Cancel queued message"
              disabled={cancellingQueued}
              size="sm"
              variant="ghost"
              onClick={() => {
                onCancelQueued(commandId);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null;
      const dismissAction =
        requestId === undefined || onDismissFailed === undefined ? null : (
          <button
            aria-label="Dismiss failed prompt"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              onDismissFailed(requestId);
            }}
            type="button"
          >
            Dismiss
          </button>
        );
      const failed =
        item.status === "failed" ? (
          <div
            className="flex items-center gap-2 px-3 text-xs text-error"
            role="alert"
          >
            <span>
              {item.author?.kind === "agent"
                ? "That Agent message didn’t make it through."
                : "Your prompt didn’t make it through."}
            </span>
            {dismissAction}
          </div>
        ) : null;
      if (item.author?.kind === "agent") {
        const open = disclosureOpen(toolDisclosure, item.id, false);
        return (
          <>
            {/* Another Agent's message: a compact block, like a tool result,
                collapsed to one line until the reader opens it. */}
            <div
              className={
                item.status === "confirmed"
                  ? "px-3 text-xs"
                  : "px-3 text-xs opacity-60"
              }
              data-agent-message={item.author.id}
              data-author={item.author.id}
            >
              <PendingMessageStatus pending={pending} />
              <button
                aria-expanded={open}
                className="text-dim flex w-full min-w-0 items-center gap-sm text-left"
                onClick={() => {
                  onToggleTool(item.id, false);
                }}
                type="button"
              >
                <span className="flex shrink-0">
                  <Sigil name="agent" size={16} />
                </span>
                <span className="shrink-0">{item.author.name}</span>
                {open ? null : (
                  <span className="min-w-0 truncate">· {item.text}</span>
                )}
              </button>
              {open ? (
                <div className="whitespace-pre-wrap break-words pl-3">
                  {item.text}
                </div>
              ) : null}
            </div>
            {failed}
            {cancelAction}
          </>
        );
      }
      return (
        <>
          {item.author ? (
            <div className="px-3 text-xs text-dim" data-author={item.author.id}>
              {item.author.name}
            </div>
          ) : null}
          {/* Awaiting admission and owner-queued prompts share the same fade. */}
          <ChatMessage pending={pending} speaker="user">
            {item.text}
          </ChatMessage>
          {failed}
          {cancelAction}
        </>
      );
    }
    case "assistant_message":
      if (!assistantMessageVisible(item)) return null;
      return (
        <>
          {item.author ? (
            <div className="px-3 text-xs text-dim" data-author={item.author.id}>
              {item.author.name}
            </div>
          ) : null}
          <ChatMessage
            isError={item.isError === true}
            pending={item.pending}
            speaker="agent"
            {...(item.thinking ? { thinking: item.thinking } : {})}
          >
            {formatAssistantText?.(item.text) ?? item.text}
          </ChatMessage>
          {item.isError && item.providerError !== undefined ? (
            <div className="px-3 text-error" data-provider-error={item.id}>
              <p className="whitespace-pre-wrap">{item.providerError}</p>
              <details>
                <summary>Provider details</summary>
                <pre className="whitespace-pre-wrap">{item.providerError}</pre>
              </details>
            </div>
          ) : null}
          {!item.pending && !item.isError
            ? renderAssistantAttachment?.(item.text)
            : null}
        </>
      );
    case "tool_group":
      return (
        <ToolGroup
          disclosure={toolDisclosure}
          group={item}
          onToggle={onToggleTool}
          renderToolActions={renderToolActions}
        />
      );
    case "compaction_divider":
      return (
        <div className="divider text-dim my-2 text-xs" role="separator">
          {item.tokensAfter === null
            ? "compacted · the agent’s memory starts below"
            : `compacted ${formatTokenCount(item.tokensBefore)} → ${formatTokenCount(item.tokensAfter)}`}
        </div>
      );
    case "compaction_notice":
      return (
        <div
          className={`px-3 text-xs ${item.result === "failed" ? "text-error" : "text-dim"}`}
          role="status"
        >
          · {compactionNoticeLabel[item.result]}
          {item.diagnostic === null ? "" : `: ${item.diagnostic}`}
        </div>
      );
  }
});
