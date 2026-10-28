import { formatTokens } from "../core/format-tokens.js";
import { formatModelIdentity } from "../core/model-identity.js";
import { formatContextUsage } from "../core/format-context.js";
import { Composer } from "@fungi.computer/caps/blocks/composer";
import { isImeComposing } from "@fungi.computer/caps/lib/ime";
import { RunFailureNotice } from "./RunFailureNotice.js";
import {
  SendAction,
  type SendActionState,
} from "@fungi.computer/caps/components/send-action";
import { formatMoney } from "@fungi.computer/caps/lib/format-money";
import { PopoverAnchor } from "@fungi.computer/caps/components/popover";
import { Status } from "@fungi.computer/caps/components/status";
import { Button } from "@fungi.computer/caps/components/button";
import { Card } from "@fungi.computer/caps/components/card";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import {
  StatusTray,
  StatusTrayList,
  StatusTrayRow,
  type StatusTrayItem,
} from "@fungi.computer/caps/blocks/status-tray";
import { ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
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
import { awaitingTakeover } from "../core/awaiting-answer.js";
import { completionFieldProps, completionKeyAction } from "./CompletionMenu.js";
import { DecisionComposer } from "./DecisionComposer.js";
import { SlashMenu } from "./SlashMenu.js";

type StatusPresentation = Readonly<{
  /** Whether work is active, so the send key offers Stop, or Queue over a draft. */
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
  /** Replace the images riding with the draft; omitted, the composer offers no Attach key. */
  onImagesChange?: ((images: ComposerController["images"]) => void) | undefined;
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
        const action = completionKeyAction(event);
        const handled =
          action === "next"
            ? slash.move(1)
            : action === "previous"
              ? slash.move(-1)
              : event.key === "Tab"
                ? slash.complete()
                : action === "dismiss"
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
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !window.matchMedia("(pointer: coarse)").matches
      ) {
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
    <>
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
        {...(slash === undefined
          ? {}
          : completionFieldProps({
              open: listOpen,
              listId: slashListId,
              selected: slash.selected,
            }))}
        className="min-h-12 max-h-[320px] resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words py-xs font-sans text-base leading-relaxed text-base-content"
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
        ref={textareaRef}
        rows={1}
        value={value}
      />
      {queuedRecall === undefined ? null : (
        <span id={`${textareaId}-recall-guidance`} className="sr-only">
          Press Up on an empty composer to recall your newest queued message.
        </span>
      )}
    </>
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

/** Read a picked image file as Session prompt image cargo; the owner admits it on send. */
async function readImage(file: File): Promise<PromptImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { type: "image", mimeType: file.type, data: btoa(binary) };
}

type PromptImage = NonNullable<ComposerController["images"]>[number];

/** The Session's settings the composer can open, by the slash alias that owns them. */
const settingsCommands = [
  { alias: "thinking", label: "Thinking level…" },
  { alias: "compact", label: "Compact context" },
] as const;

/**
 * The composer's bottom row: attach, the model key, attention, the Settings
 * chip that sums up the Session's readouts, and the one send key at the end.
 * Built from the same Caps StatusTray row Prints seats its controls in.
 */
function ComposerToolbar({
  statusChips,
  model,
  status,
  viewState,
  usage,
  context,
  slash,
  attach,
  send,
}: ComposerFooterProps &
  Readonly<{
    slash: SlashCommandController | undefined;
    attach: ReactNode;
    send: ReactNode;
  }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const tone =
    viewState.kind === "error" ? "error" : presentations[status].tone;
  // Admission must not replace an outstanding owner attention readout.
  const label = sessionReadout("idle", viewState);
  const needsAttention =
    viewState.kind === "waiting_for_you" || viewState.kind === "error";
  const modelName =
    model === undefined ? undefined : formatModelIdentity(model);
  const canPickModel = slash?.available("model") === true;
  const contextText =
    context === undefined ? undefined : formatContextUsage(context);
  const summary = [
    contextText,
    usage === undefined ? undefined : formatTokens(usage.tokens),
    usage === undefined ? undefined : formatMoney(usage.cost),
  ].filter((part) => part !== undefined);
  const commands = settingsCommands.filter(
    ({ alias }) => slash?.available(alias) === true,
  );
  const items: StatusTrayItem[] =
    summary.length === 0 && commands.length === 0 && modelName === undefined
      ? []
      : [
          {
            id: "settings",
            label: (
              <span className="composer-settings-chip">
                <SlidersHorizontal aria-hidden="true" />
                Settings
              </span>
            ),
            accessibleLabel: "Session settings",
            title: "Settings",
            content: (
              <StatusTrayList className="composer-settings">
                {modelName === undefined ? null : (
                  <StatusTrayRow primary="Model" secondary={modelName} />
                )}
                {contextText === undefined ? null : (
                  <StatusTrayRow
                    primary="Context"
                    secondary={contextText}
                    title="Context used / model context"
                  />
                )}
                {usage === undefined ? null : (
                  <StatusTrayRow
                    primary="Usage"
                    secondary={`${formatTokens(usage.tokens)} · ${formatMoney(usage.cost)}`}
                  />
                )}
                {commands.map(({ alias, label: commandLabel }) => (
                  <StatusTrayRow
                    key={alias}
                    primary={commandLabel}
                    actions={
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setOpenId(null);
                          slash?.runCommand(alias);
                        }}
                      >
                        Open
                      </Button>
                    }
                  />
                ))}
              </StatusTrayList>
            ),
          },
        ];
  return (
    <StatusTray
      className="composer-footer"
      items={items}
      align="start"
      openId={openId}
      onOpenChange={setOpenId}
      leading={
        <>
          {attach}
          {modelName === undefined ? null : canPickModel ? (
            <KeycapButton
              aria-label={`Model: ${modelName}. Change model`}
              className="composer-model-key"
              label={modelName}
              readout={
                <ChevronDown
                  aria-hidden="true"
                  className="size-[var(--stipe-icon-size-sm)] shrink-0"
                />
              }
              onClick={() => {
                slash.runCommand("model");
              }}
              title="Change model"
            />
          ) : (
            <span className="composer-model-readout">{modelName}</span>
          )}
          {needsAttention ? (
            <Status label={label} title={label} tone={tone} />
          ) : null}
          {statusChips?.map((chip, index) => (
            <span
              key={index}
              className="composer-status-chip min-w-0 truncate"
              title={chip}
            >
              {chip}
            </span>
          ))}
        </>
      }
      trailing={
        <>
          {summary.length === 0 ? null : (
            <span
              className="composer-readout"
              title="Context used / model context · tokens · cost"
            >
              {summary.join(" · ")}
            </span>
          )}
          {send}
        </>
      }
    />
  );
}

/** Images riding with the draft, drawn as small tiles above the text. */
function ComposerAttachments({
  images,
  onRemove,
}: Readonly<{
  images: NonNullable<ComposerController["images"]>;
  onRemove: ((index: number) => void) | undefined;
}>) {
  return (
    <ul aria-label="Attached images" className="composer-attachments">
      {images.map((image, index) => (
        <li key={index}>
          <img
            alt={`Attached image ${String(index + 1)}`}
            className="mask mask-squircle"
            src={`data:${image.mimeType};base64,${image.data}`}
          />
          {onRemove === undefined ? null : (
            <IconButton
              aria-label={`Remove attached image ${String(index + 1)}`}
              className="composer-attachment-remove"
              icon={<X />}
              onClick={() => {
                onRemove(index);
              }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export const ChatComposer = memo(function ChatComposer({
  queuedRecall,
  onImagesChange,
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
  const fileInput = useRef<HTMLInputElement>(null);
  const { busy } = presentations[status];
  // A waiting decision takes the composer over an empty draft, or on request.
  const takeover =
    slash === undefined ? undefined : awaitingTakeover(slash.awaiting, draft);
  const takeoverKey = takeover?.key;
  const seenTakeover = useRef<string | undefined>(undefined);
  const hadFocus = useRef(false);
  if (seenTakeover.current !== takeoverKey) {
    seenTakeover.current = takeoverKey;
    hadFocus.current =
      takeoverKey !== undefined &&
      document.activeElement === textareaRef.current;
  }
  const restoreFocus = hadFocus.current;
  useEffect(() => {
    if (takeoverKey === undefined && restoreFocus) textareaRef.current?.focus();
  }, [takeoverKey, restoreFocus, textareaRef]);
  const images = queuedRecall?.images ?? [];
  const recallBusy = queuedRecall?.recallState.kind === "recalling";
  const cannotSend =
    recallBusy || (draft.trim().length === 0 && images.length === 0);
  // One key in one place: Send when idle, Stop while the Agent works.
  // Enter still queues a typed follow-up during a run.
  // One key says what Enter does: Send when idle; while the Agent works,
  // Stop over an empty draft and Queue once there is a draft to queue.
  const sendState: SendActionState = cannotSend
    ? busy
      ? "busy"
      : "empty"
    : "ready";
  const sendLabel = busy ? "Queue follow-up" : "Send message";
  const sendAction = (
    <SendAction
      aria-label={sendLabel}
      className="composer-send-key"
      disabled={
        sendState === "busy" &&
        (recallBusy || status === "queued" || status === "cancelling")
      }
      onClick={() => {
        onSend(busy ? "followUp" : "steer");
      }}
      onStop={onAbort}
      state={sendState}
      stopLabel="Stop current turn"
      title={
        sendState === "busy"
          ? "Stop the current turn. Queued messages keep running in order."
          : sendLabel
      }
      tone={actionVariant === "primary" ? "primary" : "neutral"}
    />
  );
  const attach =
    onImagesChange === undefined ? null : (
      <>
        <input
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Choose images to attach"
          hidden
          multiple
          onChange={(event) => {
            const picked = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void Promise.all(picked.map(readImage)).then((read) => {
              onImagesChange([...images, ...read]);
            });
          }}
          ref={fileInput}
          type="file"
        />
        <KeycapButton
          aria-label="Attach images"
          className="composer-attach-key"
          icon={<Plus />}
          label={null}
          onClick={() => fileInput.current?.click()}
          title="Attach images"
        />
      </>
    );
  // Visitors see only the field and the send key, never internal readouts.
  const footerProps: ComposerFooterProps = { status, viewState };
  if (showFooter) {
    footerProps.statusChips = statusChips;
    if (model) footerProps.model = model;
    if (usage) footerProps.usage = usage;
    if (context) footerProps.context = context;
  }

  return (
    <div className="chat-composer not-prose flex-shrink-0">
      {admissionError !== undefined ? (
        <div className="px-3 py-1.5 text-xs text-error" role="alert">
          {admissionError === "offline_queue_full"
            ? "One prompt is already queued; it sends when the service is back."
            : "Too many prompts are still awaiting admission. Try again shortly."}
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
          role={slash.interactions.notice.tone === "error" ? "alert" : "status"}
        >
          {slash.interactions.notice.message}
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {takeover === undefined || slash === undefined
          ? ""
          : `Agent ${takeover.kind} ${String(slash.awaiting.position)} of ${String(slash.awaiting.total)} needs your answer`}
      </div>
      <PopoverAnchor className="composer-body">
        {slash === undefined ? null : (
          <SlashMenu slash={slash} listId={slashListId} />
        )}
        <Card aria-label="Message composer" className="composer-card">
          <Composer
            attachments={
              takeover === undefined && images.length > 0 ? (
                <ComposerAttachments
                  images={images}
                  onRemove={
                    onImagesChange === undefined
                      ? undefined
                      : (index) => {
                          onImagesChange(
                            images.filter((_image, at) => at !== index),
                          );
                        }
                  }
                />
              ) : undefined
            }
            input={
              <>
                {takeover === undefined || slash === undefined ? null : (
                  <DecisionComposer
                    item={takeover}
                    key={takeover.key}
                    position={slash.awaiting.position}
                    total={slash.awaiting.total}
                    onLater={() => {
                      slash.store.awaiting.later(takeover.key);
                    }}
                    takeFocus={hadFocus.current}
                  />
                )}
                {/* The draft stays mounted, so it and its history return untouched. */}
                <div hidden={takeover !== undefined}>
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
                </div>
              </>
            }
            action={
              // Visitors get the field and the send key, no toolbar.
              takeover === undefined && !showFooter ? sendAction : undefined
            }
            toolbar={
              // A decision brings its own Later and Send row to the bottom edge.
              takeover !== undefined || !showFooter ? undefined : (
                <ComposerToolbar
                  {...footerProps}
                  slash={slash}
                  attach={attach}
                  send={sendAction}
                />
              )
            }
          />
        </Card>
      </PopoverAnchor>
      {slash === undefined ? null : (
        <p className="sr-only" id={`${textareaId}-guidance`}>
          {formatHints(slash.hints)}
        </p>
      )}
    </div>
  );
});
