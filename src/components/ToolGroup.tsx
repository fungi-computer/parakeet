import { Badge } from "@fungi.computer/caps/components/badge";
import { DiffView } from "@fungi.computer/caps/components/diff-view";
import { Disclosure } from "@fungi.computer/caps/components/disclosure";
import { Status } from "@fungi.computer/caps/components/status";
import { Sigil } from "@fungi.computer/sigils";
import {
  createContext,
  memo,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import {
  disclosureOpen,
  toolCallDefaultOpen,
  toolGroupDefaultOpen,
  visibleToolCalls,
  type ToolDisclosureState,
} from "../core/tool-groups.js";
import {
  formatToolDuration,
  toolStatusTone as statusTone,
  type ToolCallView,
  type ToolCallSection,
  toolKindSigils,
  toolLiveLines,
} from "../core/tool-view.js";
import type { ToolGroupItem, ToolItem } from "../store/types.js";
import { AgentHead } from "./AgentHead.js";
import { CodeBlock } from "./CodeBlock.js";

/** Flip one group or call; the caller owns the view-only disclosure state. */
export type ToggleToolDisclosure = (id: string, defaultOpen: boolean) => void;

/** Items beyond a section's preview, unless the reader asked for all. */
function visible<T>(
  items: readonly T[],
  preview: number,
  full: boolean,
): Readonly<{ shown: readonly T[]; hidden: number }> {
  return full || items.length <= preview
    ? { shown: items, hidden: 0 }
    : { shown: items.slice(0, preview), hidden: items.length - preview };
}

function ShowMore({
  hidden,
  onShowAll,
}: Readonly<{ hidden: number; onShowAll: () => void }>) {
  if (hidden === 0) return null;
  return (
    <button
      className="btn btn-ghost btn-xs text-dim"
      onClick={onShowAll}
      type="button"
    >
      Show {String(hidden)} more lines
    </button>
  );
}

/** A bordered, rounded output box; only the inner pre scrolls and fades. */
function MonoBlock({
  children,
  ...props
}: Readonly<ComponentPropsWithoutRef<"pre">>) {
  return (
    <div className="not-prose overflow-hidden rounded-lg border border-base-300 bg-base-200">
      <pre
        {...props}
        className="parakeet-edge-fade m-0 overflow-x-auto px-sm py-xs font-mono text-[10px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

function SectionView({
  section,
  full,
  onShowAll,
}: Readonly<{
  section: ToolCallSection;
  full: boolean;
  onShowAll: () => void;
}>) {
  switch (section.kind) {
    case "diff": {
      const { shown, hidden } = visible(section.lines, section.preview, full);
      return (
        <div className="not-prose">
          <DiffView hiddenLines={0} lines={shown} />
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
    case "excerpt": {
      const { shown, hidden } = visible(section.lines, section.preview, full);
      return (
        <div>
          <MonoBlock data-parakeet-section="excerpt">
            {shown.map((line, index) => (
              <span className="block whitespace-pre" key={String(index)}>
                {line.number === undefined ? null : (
                  <span className="text-dim mr-sm inline-block w-8 select-none text-right">
                    {String(line.number)}
                  </span>
                )}
                {line.text}
              </span>
            ))}
          </MonoBlock>
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
    case "matches": {
      const { shown, hidden } = visible(section.matches, section.preview, full);
      return (
        <div>
          <MonoBlock data-parakeet-section="matches">
            {shown.map((match, index) => (
              <span className="block whitespace-pre" key={String(index)}>
                {match.location === "" ? null : (
                  <span className="text-info mr-sm">{match.location}</span>
                )}
                {match.text}
              </span>
            ))}
          </MonoBlock>
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
    case "command":
    case "script": {
      const { shown, hidden } = visible(section.lines, section.preview, full);
      return (
        <div>
          <MonoBlock data-parakeet-section={section.kind}>
            {shown.map((line, index) => (
              <span className="block whitespace-pre" key={String(index)}>
                {section.kind === "command" && index === 0 ? (
                  <span className="text-dim select-none">$ </span>
                ) : null}
                {line}
              </span>
            ))}
          </MonoBlock>
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
    case "output": {
      const { shown, hidden } = visible(section.lines, section.preview, full);
      return (
        <div>
          <MonoBlock data-parakeet-section="output">
            {shown.map((line, index) => (
              <span
                className={
                  line.stream === "stderr"
                    ? "block whitespace-pre text-error"
                    : "block whitespace-pre"
                }
                data-stream={line.stream}
                key={String(index)}
              >
                {line.stream === "stderr" ? (
                  <span className="select-none">▍</span>
                ) : null}
                {line.text}
              </span>
            ))}
          </MonoBlock>
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
    case "text": {
      const { shown, hidden } = visible(section.lines, section.preview, full);
      return (
        <div>
          <CodeBlock
            className="overflow-hidden rounded-lg"
            content={shown.join("\n")}
            header={section.label}
            {...(section.language === undefined
              ? {}
              : { language: section.language })}
          />
          <ShowMore hidden={hidden} onShowAll={onShowAll} />
        </div>
      );
    }
  }
}

/** The tool calls whose question card is open: each is waiting on the person. */
export const AnswerWaitContext: React.Context<ReadonlySet<string>> =
  createContext<ReadonlySet<string>>(new Set());

const waitingWords = "Waiting for your answer";

function CallBody({
  call,
  tool,
  disclosure,
  onToggle,
  mediaClaimed,
}: Readonly<{
  call: ToolCallView;
  tool: ToolItem | undefined;
  mediaClaimed: boolean;
  disclosure: ToolDisclosureState;
  onToggle: ToggleToolDisclosure;
}>) {
  const fullId = `${call.id}:full`;
  const full = disclosureOpen(disclosure, fullId, false);
  const showAll = () => {
    onToggle(fullId, false);
  };
  return (
    <div className="space-y-1.5 py-1.5 pr-2" data-parakeet-call-body>
      {call.error === undefined ? null : (
        <p
          className={`not-prose m-0 break-words font-mono text-[11px] ${
            call.recovered === true ? "text-dim" : "text-error"
          }`}
          role={call.recovered === true ? undefined : "alert"}
        >
          {call.error}
        </p>
      )}
      {call.sections.map((section, index) => (
        <SectionView
          full={full}
          key={`${section.kind}:${String(index)}`}
          onShowAll={showAll}
          section={section}
        />
      ))}
      {(mediaClaimed ? [] : (tool?.result?.content ?? []))
        .filter((part) => part.type === "image")
        .map((part, index) => (
          <img
            alt="Tool result"
            className="max-w-full"
            key={`${call.id}-image-${String(index)}`}
            src={`data:${part.mimeType};base64,${part.data}`}
            style={{ maxHeight: 400 }}
          />
        ))}
    </div>
  );
}

function CallRow({
  call,
  tool,
  disclosureId,
  size,
  disclosure,
  onToggle,
  renderToolActions,
  claimsToolMedia,
}: Readonly<{
  call: ToolCallView;
  tool: ToolItem | undefined;
  disclosureId: string;
  size: "group" | "row";
  disclosure: ToolDisclosureState;
  onToggle: ToggleToolDisclosure;
  renderToolActions?: ((item: ToolItem) => ReactNode) | undefined;
  claimsToolMedia?: ((item: ToolItem) => boolean) | undefined;
}>) {
  const defaultOpen = toolCallDefaultOpen(call);
  const open = disclosureOpen(disclosure, disclosureId, defaultOpen);
  const running = call.status === "running";
  const asking = useContext(AnswerWaitContext);
  const waiting = call.status === "running" && asking.has(call.id);
  return (
    <div data-parakeet-call={call.kind} data-status={call.status}>
      <Disclosure
        leading={
          call.identity === undefined ? (
            <Sigil name={toolKindSigils[call.kind]} size={16} />
          ) : (
            // A call that renamed the Agent shows the Agent's own head.
            <AgentHead
              avatar={call.identity.avatar}
              name={call.identity.name}
              size={16}
            />
          )
        }
        onOpenChange={() => {
          onToggle(disclosureId, defaultOpen);
        }}
        open={open}
        size={size}
        summary={
          <>
            <span className="text-base-content">
              {waiting ? waitingWords : running ? call.activeVerb : call.verb}
            </span>{" "}
            <span className="font-mono">{call.label}</span>
          </>
        }
        tone={
          call.status === "error" && call.recovered !== true
            ? "error"
            : "neutral"
        }
        trailing={
          <>
            {call.recovered === true ? <span>recovered</span> : null}
            {call.parked === true ? <span>Sent for approval</span> : null}
            {call.exitCode === undefined ? null : (
              <Badge
                size="sm"
                tone={
                  call.status === "error" && call.recovered !== true
                    ? "error"
                    : "neutral"
                }
              >
                exit {String(call.exitCode)}
              </Badge>
            )}
            {call.durationMs === undefined ? null : (
              <span>{formatToolDuration(call.durationMs)}</span>
            )}
            <Status
              motion={running ? "bounce" : "none"}
              title={
                call.parked === true
                  ? "Sent for approval"
                  : call.status === "unknown"
                    ? "result unavailable"
                    : call.status
              }
              tone={statusTone(call.status, call.recovered === true)}
            />
          </>
        }
      >
        <CallBody
          call={call}
          disclosure={disclosure}
          onToggle={onToggle}
          mediaClaimed={tool !== undefined && claimsToolMedia?.(tool) === true}
          tool={tool}
        />
      </Disclosure>
      {call.live === undefined ? null : (
        <MonoBlock aria-label="Live tool output">
          {toolLiveLines(call, open).map((line, index) => (
            <span className="block whitespace-pre" key={String(index)}>
              {line || "\u00a0"}
            </span>
          ))}
        </MonoBlock>
      )}
      {call.status === "completed" && tool?.result !== undefined
        ? renderToolActions?.(tool)
        : null}
    </div>
  );
}

/** Recent finished calls, or a live group, with reader-owned disclosure. */
export const ToolGroup = memo(function ToolGroup({
  group,
  disclosure,
  onToggle,
  renderToolActions,
  claimsToolMedia,
}: Readonly<{
  group: ToolGroupItem;
  disclosure: ToolDisclosureState;
  onToggle: ToggleToolDisclosure;
  renderToolActions?: ((item: ToolItem) => ReactNode) | undefined;
  claimsToolMedia?: ((item: ToolItem) => boolean) | undefined;
}>) {
  const defaultOpen = toolGroupDefaultOpen(group);
  const open = disclosureOpen(disclosure, group.id, defaultOpen);
  const running = group.status === "running";
  const active = group.active;
  const asking = useContext(AnswerWaitContext);
  const single = group.calls.length === 1 ? group.calls[0] : undefined;
  if (single !== undefined)
    return (
      <div>
        <CallRow
          call={single}
          disclosure={disclosure}
          disclosureId={single.id}
          onToggle={onToggle}
          renderToolActions={renderToolActions}
          claimsToolMedia={claimsToolMedia}
          size="row"
          tool={group.tools[0]}
        />
      </div>
    );
  return (
    <div>
      <Disclosure
        className="[&>.caps-disclosure-panel]:hidden"
        leading={<Sigil name="list" size={16} />}
        onOpenChange={() => {
          onToggle(group.id, defaultOpen);
        }}
        open={open}
        summary={
          running && active !== undefined ? (
            <>
              <span className="text-base-content">
                {asking.has(active.id) ? waitingWords : active.activeVerb}
              </span>{" "}
              <span className="font-mono">{active.label}</span> ·{" "}
              {String(group.calls.length)}{" "}
              {group.calls.length === 1 ? "call" : "calls"}
            </>
          ) : (
            <span className="text-base-content">
              {group.summary} · {String(group.calls.length)}{" "}
              {group.calls.length === 1 ? "call" : "calls"}
            </span>
          )
        }
        tone={group.status === "error" ? "error" : "neutral"}
        trailing={
          <>
            {group.failedCount > 0 ? (
              <span className="text-error">
                {String(group.failedCount)} failed
              </span>
            ) : null}
            {group.recoveredCount > 0 ? (
              <span>{String(group.recoveredCount)} recovered</span>
            ) : null}
            {group.calls.some((call) => call.parked === true) ? (
              <span>Sent for approval</span>
            ) : null}
            {group.durationMs === undefined ? null : (
              <span>{formatToolDuration(group.durationMs)}</span>
            )}
            <Status
              motion={running ? "bounce" : "none"}
              title={
                group.calls.some((call) => call.parked === true)
                  ? "Sent for approval"
                  : group.status === "unknown"
                    ? "result unavailable"
                    : group.status
              }
              tone={statusTone(group.status)}
            />
          </>
        }
      />
      {visibleToolCalls(group, open).map((call) => (
        <CallRow
          call={call}
          disclosure={disclosure}
          disclosureId={call.id}
          key={call.id}
          onToggle={onToggle}
          renderToolActions={renderToolActions}
          claimsToolMedia={claimsToolMedia}
          size="row"
          tool={group.tools.find((tool) => tool.id === call.id)}
        />
      ))}
      {group.status === "completed" && group.calls.length > 3 ? (
        <button
          aria-expanded={open}
          className="btn btn-ghost btn-xs text-dim"
          onClick={() => {
            onToggle(group.id, defaultOpen);
          }}
          type="button"
        >
          {open ? "Show less" : `Show all ${String(group.calls.length)} calls`}
        </button>
      ) : null}
    </div>
  );
});
