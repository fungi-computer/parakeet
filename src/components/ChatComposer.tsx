import { formatTokens } from "../core/format-tokens.js";
import { formatModelIdentity } from "../core/model-identity.js";
import { formatContextUsage } from "../core/format-context.js";
import {
  Composer,
  type ComposerProps,
} from "@fungi.computer/caps/blocks/composer";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import { RunFailureNotice } from "./RunFailureNotice.js";
import { Button } from "@fungi.computer/caps/components/button";
import { formatMoney } from "@fungi.computer/caps/lib/format-money";
import {
  Popover,
  PopoverAnchor,
} from "@fungi.computer/caps/components/popover";
import { Status } from "@fungi.computer/caps/components/status";
import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { Textarea } from "@fungi.computer/caps/components/textarea";
import type {
  PromptDelivery,
  SessionContext,
} from "@fungi.computer/shiitake/client";
import { formatHints } from "../commands/hints.js";
import type { SlashCommandController } from "../commands/use-slash-commands.js";
import type {
  ComposerController,
  ParakeetStatus,
  ParakeetSessionViewState,
} from "../conversation.js";
import { SlashMenu, slashOptionId } from "./SlashMenu.js";

type StatusPresentation = Readonly<{
  /** Whether work is active, so the composer offers Cancel and Queue. */
  busy: boolean;
  tone: "error" | "neutral" | "success" | "warning";
}>;

const presentations = {
  connecting: {
    busy: false,
    tone: "neutral",
  },
  cancelling: {
    busy: true,
    tone: "warning",
  },
  error: {
    busy: false,
    tone: "error",
  },
  idle: {
    busy: false,
    tone: "neutral",
  },
  queued: {
    busy: true,
    tone: "warning",
  },
  retrying: {
    busy: true,
    tone: "warning",
  },
  sending: {
    busy: true,
    tone: "success",
  },
  streaming: {
    busy: true,
    tone: "success",
  },
  thinking: {
    busy: true,
    tone: "warning",
  },
  disconnected: {
    busy: false,
    tone: "neutral",
  },
} as const satisfies Record<ParakeetStatus, StatusPresentation>;

export type ChatComposerModel = Readonly<{ model: string; provider: string }>;
export type ChatComposerUsage = Readonly<{ cost: number; tokens: number }>;
type ComposerFooterProps = {
  statusChips?: readonly string[] | undefined;
  model?: ChatComposerModel;
  status: ParakeetStatus;
  /** Session owner readout, separate from local prompt admission. */
  viewState: ParakeetSessionViewState;
  usage?: ChatComposerUsage;
  context?: SessionContext;
};

export type ChatComposerProps = {
  /** Undefined for visitor composers without a caller-owned pending queue. */
  queuedRecall:
    Pick<ComposerController, "recall" | "recallState" | "images"> | undefined;
  /** Caller-owned prompt hint; omitted for the ordinary Session composer. */
  placeholder?: string | undefined;
  /** Hide internal model, usage and status readouts for visitors. */
  showFooter?: boolean;
  /** Display-only status text supplied by the conversation's admitted entries. */
  statusChips?: readonly string[] | undefined;
  actionVariant?: "primary" | "outline" | undefined;
  draft: string;
  failure: ComposerController["failure"];
  failureCause?: string | undefined;
  model?: ChatComposerModel | undefined;
  onAbort: () => void;
  onChange: (value: string) => void;
  onRetry: () => void;
  /** Submit the draft; `followUp` while a run is active, otherwise `steer`. */
  onSend: (delivery: PromptDelivery) => void;
  admissionError?: ComposerController["admissionError"];
  status: ParakeetStatus;
  /** Session owner readout, separate from local prompt admission. */
  viewState: ParakeetSessionViewState;
  textareaRef: RefObject<HTMLTextAreaElement>;
  usage?: ChatComposerUsage | undefined;
  /** Context use the Session's compaction measures, once known. */
  context?: SessionContext | undefined;
  /** Parakeet's slash controller; the composer only draws and forwards keys. */
  slash?: SlashCommandController | undefined;
};

function HostComposerTextarea({
  placeholder,
  onChange,
  onSend,
  onAbort,
  slash,
  slashListId,
  textareaId,
  textareaRef,
  value,
  queuedRecall,
}: {
  queuedRecall: ChatComposerProps["queuedRecall"];
  placeholder: string | undefined;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  slash: SlashCommandController | undefined;
  slashListId: string;
  textareaId: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
}) {
  const latestValue = useRef(value);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  latestValue.current = value;
  const recallState = queuedRecall?.recallState;
  const recalling = recallState?.kind === "recalling";
  useLayoutEffect(() => {
    if (recallState?.kind !== "restored") return;
    setHistoryIndex(-1);
    const textarea = textareaRef.current;
    if (textarea !== null)
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [recallState, textareaRef]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${String(Math.min(textarea.scrollHeight, 320))}px`;
  }, [textareaRef, value]);

  const saveAndSend = useCallback(() => {
    const draft = latestValue.current.trim();
    if (!draft && (queuedRecall?.images?.length ?? 0) === 0) return;
    onSend();
    if (draft)
      setHistory((previous) =>
        previous.at(-1) === draft ? previous : [...previous, draft],
      );
    setHistoryIndex(-1);
  }, [onSend, queuedRecall?.images?.length]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (isImeComposing(event)) return;
      if (recalling) return;
      if (slash?.open === true) {
        const handled =
          event.key === "ArrowDown"
            ? slash.move(1)
            : event.key === "ArrowUp"
              ? slash.move(-1)
              : event.key === "Tab"
                ? slash.complete()
                : event.key === "Escape"
                  ? slash.dismiss()
                  : false;
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onAbort();
        return;
      }
      if (
        queuedRecall !== undefined &&
        event.key === "ArrowUp" &&
        !event.repeat &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        slash?.open !== true &&
        latestValue.current === "" &&
        (queuedRecall.images?.length ?? 0) === 0 &&
        document.activeElement === event.currentTarget
      ) {
        event.preventDefault();
        const input = event.currentTarget;
        void queuedRecall.recall().then((outcome) => {
          if (
            outcome !== "empty" ||
            !input.isConnected ||
            input.value !== "" ||
            textareaRef.current !== input ||
            history.length === 0
          )
            return;
          const next =
            historyIndex === -1 ? history.length - 1 : historyIndex - 1;
          const entry = history[next];
          if (entry !== undefined) {
            setHistoryIndex(next);
            onChange(entry);
          }
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        saveAndSend();
        return;
      }
      if (
        event.key === "ArrowUp" &&
        textareaRef.current?.selectionStart === 0 &&
        history.length > 0 &&
        (historyIndex === -1 || historyIndex > 0)
      ) {
        event.preventDefault();
        const next =
          historyIndex === -1 ? history.length - 1 : historyIndex - 1;
        setHistoryIndex(next);
        const entry = history[next];
        if (entry !== undefined) onChange(entry);
        return;
      }
      if (event.key === "ArrowDown" && historyIndex !== -1) {
        event.preventDefault();
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(-1);
          onChange("");
        } else {
          setHistoryIndex(next);
          const entry = history[next];
          if (entry !== undefined) onChange(entry);
        }
      }
    },
    [
      history,
      historyIndex,
      onAbort,
      onChange,
      saveAndSend,
      slash,
      textareaRef,
      queuedRecall,
      recalling,
    ],
  );
  const listOpen =
    slash?.open === true && slash.completion.kind !== "none"
      ? slash.completion.items.length > 0
      : false;

  return (
    <div className="relative min-w-0 flex-1">
      <label className="sr-only" htmlFor={textareaId}>
        Message
      </label>
      <Textarea
        aria-describedby={
          [
            slash === undefined ? undefined : `${textareaId}-guidance`,
            queuedRecall === undefined
              ? undefined
              : `${textareaId}-recall-guidance`,
          ]
            .filter((id) => id !== undefined)
            .join(" ") || undefined
        }
        aria-busy={recalling}
        readOnly={recalling}
        aria-autocomplete="list"
        aria-controls={listOpen ? slashListId : undefined}
        aria-expanded={listOpen}
        aria-activedescendant={
          listOpen && slash !== undefined
            ? slashOptionId(slashListId, slash.selected)
            : undefined
        }
        className="join-item min-h-[48px] max-h-[320px] w-full resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words px-3 py-[calc((3rem-1.25rem)/2)] font-sans text-xs text-base-content !border-0 !bg-transparent !shadow-none focus:!outline-none"
        id={textareaId}
        onChange={(event) => {
          onChange(event.target.value);
          setHistoryIndex(-1);
        }}
        onKeyDown={onKeyDown}
        placeholder={
          placeholder ??
          (slash === undefined ? "Ask agent..." : "Ask agent… (/ for commands)")
        }
        role={slash === undefined ? undefined : "combobox"}
        ref={textareaRef}
        rows={1}
        value={value}
      />
      {queuedRecall === undefined ? null : (
        <span id={`${textareaId}-recall-guidance`} className="sr-only">
          Press Up on an empty composer to recall your newest queued message.
        </span>
      )}
      {(queuedRecall?.images?.length ?? 0) === 0 ? null : (
        <p className="text-xs">
          {queuedRecall?.images?.length} attached image(s)
        </p>
      )}
    </div>
  );
}

/** Full Session readout for announcements; the footer only draws attention states. */
export function sessionReadout(
  status: ParakeetStatus,
  view: ParakeetSessionViewState,
): string {
  if (view.kind === "connecting") return "connecting";
  if (view.kind === "disconnected") return "unavailable";
  if (status === "sending") return "sending prompt";
  if (
    status === "queued" &&
    (view.kind === "idle" ||
      view.kind === "waiting_for_you" ||
      view.kind === "error")
  )
    return "prompt accepted";
  switch (view.kind) {
    case "waiting_for_you":
      return "waiting for you";
    case "responding":
      return "writing";
    case "running_tool":
      return `running ${view.tool}`;
    case "retrying":
      return `retrying ${String(view.attempt)}/${String(view.maxAttempts)}`;
    case "error":
      return "failed";
    case "queued":
      return "queued";
    case "cancelling":
      return "cancelling";
    case "compacting":
      return "compacting";
    case "thinking":
      return "thinking";
    case "idle":
      return "idle";
  }
}

function ComposerFooter({
  statusChips,
  model,
  status,
  viewState,
  usage,
  context,
}: ComposerFooterProps) {
  const tone =
    viewState.kind === "error" ? "error" : presentations[status].tone;
  // Admission must not replace an outstanding owner attention readout.
  const label = sessionReadout("idle", viewState);
  const needsAttention =
    viewState.kind === "waiting_for_you" || viewState.kind === "error";
  return (
    <div className="composer-footer">
      {needsAttention ? (
        <Status label={label} title={label} tone={tone} />
      ) : null}
      {statusChips?.map((chip, index) => (
        <span key={index} className="min-w-0 truncate" title={chip}>
          {chip}
        </span>
      ))}
      {model ? (
        <>
          <span className="footer-divider" />
          <span className="font-mono font-semibold">
            {formatModelIdentity(model)}
          </span>
        </>
      ) : null}
      {context ? (
        <>
          <span className="footer-divider" />
          <span className="font-mono" title="Context used / model context">
            {formatContextUsage(context)}
          </span>
        </>
      ) : null}
      {usage ? (
        <>
          <span className="footer-divider" />
          <span className="font-mono">{formatTokens(usage.tokens)}</span>
          <span className="footer-divider" />
          <span className="font-mono">{formatMoney(usage.cost)}</span>
        </>
      ) : null}
    </div>
  );
}

export const ChatComposer = memo(function ChatComposer({
  queuedRecall,
  placeholder,
  showFooter = true,
  statusChips,
  actionVariant = "primary",
  draft,
  failure,
  failureCause,
  admissionError,
  model,
  onAbort,
  onChange,
  onRetry,
  onSend,
  status,
  viewState,
  textareaRef,
  usage,
  context,
  slash,
}: ChatComposerProps) {
  const textareaId = useId();
  const slashListId = `${textareaId}-commands`;
  const { busy } = presentations[status];
  const recallBusy = queuedRecall?.recallState.kind === "recalling";
  const cannotSend =
    recallBusy ||
    (draft.trim().length === 0 && (queuedRecall?.images?.length ?? 0) === 0);
  const composerAction = busy ? (
    <div className="flex items-stretch">
      <Button
        aria-label="Stop current turn"
        className="join-item h-auto min-h-0 self-stretch"
        data-testid="composer-stop"
        disabled={recallBusy || status === "queued" || status === "cancelling"}
        onClick={onAbort}
        title="Stop the current turn. Queued messages keep running in order."
        size="lg"
        variant="ghost"
      >
        Stop
      </Button>
      <Button
        aria-label="Queue follow-up"
        className="join-item h-auto min-h-0 self-stretch"
        disabled={cannotSend}
        onClick={() => {
          onSend("followUp");
        }}
        size="lg"
        variant={actionVariant}
      >
        Queue
      </Button>
    </div>
  ) : (
    <Button
      aria-label="Send message"
      className="join-item h-auto min-h-0 self-stretch"
      disabled={cannotSend}
      onClick={() => {
        onSend("steer");
      }}
      title="Send"
      size="lg"
      variant={actionVariant}
    >
      Send
    </Button>
  );
  const composerInput = (
    <HostComposerTextarea
      queuedRecall={queuedRecall}
      placeholder={placeholder}
      onChange={onChange}
      onAbort={onAbort}
      onSend={() => {
        onSend(busy ? "followUp" : "steer");
      }}
      slash={slash}
      slashListId={slashListId}
      textareaId={textareaId}
      textareaRef={textareaRef}
      value={draft}
    />
  );
  const composerProps: ComposerProps = {
    action: composerAction,
    input: composerInput,
  };
  const footerProps: ComposerFooterProps = { status, viewState, statusChips };
  if (model) footerProps.model = model;
  if (usage) footerProps.usage = usage;
  if (context) footerProps.context = context;

  return (
    <div className="chat-composer not-prose flex-shrink-0 border-t border-base-300">
      <div className="relative">
        {admissionError === "queue_full" ? (
          <div className="px-3 py-1.5 text-xs text-error" role="alert">
            Too many prompts are still awaiting admission. Try again shortly.
          </div>
        ) : null}
        {failure !== undefined ? (
          <RunFailureNotice
            failure={failure}
            cause={failureCause}
            onRetry={onRetry}
          />
        ) : null}
        {slash?.interactions.notice === undefined ? null : (
          <div
            className="parakeet-command-notice px-3 py-1.5 text-xs"
            data-tone={slash.interactions.notice.tone}
            role={
              slash.interactions.notice.tone === "error" ? "alert" : "status"
            }
          >
            {slash.interactions.notice.message}
          </div>
        )}
        <PopoverAnchor className="composer-body">
          {slash === undefined ? null : (
            <Popover open={slash.open} side="top" data-parakeet-slash="">
              <SlashMenu slash={slash} listId={slashListId} />
            </Popover>
          )}
          <Composer {...composerProps} />
        </PopoverAnchor>
      </div>
      {showFooter ? <ComposerFooter {...footerProps} /> : null}
      {slash === undefined ? null : (
        <p className="sr-only" id={`${textareaId}-guidance`}>
          {formatHints(slash.hints)}
        </p>
      )}
    </div>
  );
});
