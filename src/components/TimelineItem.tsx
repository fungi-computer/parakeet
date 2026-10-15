import { memo, type ReactNode } from "react";

import {
  initialToolDisclosure,
  type ToolDisclosureState,
} from "../core/tool-groups.js";
import { assistantMessageVisible } from "../core/assistant-visibility.js";
import { formatTokenCount } from "../core/format-context.js";
import type { TimelineItem as TimelineRow, ToolItem } from "../store/types.js";
import { ChatMessage } from "./ChatMessage.js";
import { ToolGroup, type ToggleToolDisclosure } from "./ToolGroup.js";

const ignoreToggle: ToggleToolDisclosure = () => undefined;

export const TimelineItem = memo(function TimelineItem({
  item,
  onDismissFailed,
  renderToolActions,
  renderAssistantAttachment,
  formatAssistantText,
  toolDisclosure = initialToolDisclosure,
  onToggleTool = ignoreToggle,
}: Readonly<{
  item: TimelineRow;
  onDismissFailed?: ((requestId: string) => void) | undefined;
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
      const requestId = item.requestId;
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
      return (
        <>
          {item.author ? (
            <div className="px-3 text-xs text-dim" data-author={item.author.id}>
              {item.author.name}
            </div>
          ) : null}
          {/* Dimmed until the Agent takes the prompt; no status sub-line. */}
          <ChatMessage pending={item.status !== "confirmed"} speaker="user">
            {item.text}
          </ChatMessage>
          {item.status === "failed" ? (
            <div
              className="flex items-center gap-2 px-3 text-xs text-error"
              role="alert"
            >
              <span>Your prompt didn’t make it through.</span>
              {dismissAction}
            </div>
          ) : null}
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
          ·{" "}
          {item.result === "failed"
            ? "compaction failed"
            : "nothing to compact"}
          {item.diagnostic === null ? "" : `: ${item.diagnostic}`}
        </div>
      );
  }
});
