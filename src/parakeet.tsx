import type { ClientEntryV1 } from "@fungi.computer/shiitake/client-entry";
import { Button } from "@fungi.computer/caps/components/button";
import { Dialog, DialogContent } from "@fungi.computer/caps/components/dialog";
import { ScrollToBottomBlob } from "@fungi.computer/caps/components/scroll-to-bottom-blob";
import { createWhistle } from "@fungi.computer/whistle";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import {
  ParakeetProvider,
  useComposer,
  useClientContributions,
  useDismissFailedPrompt,
  useStatus,
  useTimeline,
} from "./conversation.js";
import { awaitingTakeover } from "./core/awaiting-answer.js";
import { initialToolDisclosure, toggleDisclosure } from "./core/tool-groups.js";
import {
  authorDisplayNames,
  type ParakeetAuthorOf,
} from "./core/author-labels.js";
import type { ToolItem } from "./store/types.js";
import { useTimelineItemKey } from "./core/use-timeline-item-key.js";
import type { ParakeetSession } from "./session.js";
import {
  ChatComposer,
  sessionReadout,
  type ChatComposerProps,
} from "./components/ChatComposer.js";
import { ClientRows } from "./components/ClientRows.js";
import { useClientActions } from "./client-contributions.js";
import { placeClientTimeline } from "./core/client-timeline.js";
import type { RowV1 } from "@fungi.computer/gills";
import { InteractionPanel } from "./components/InteractionPanel.js";
import {
  useSlashCommands,
  type ParakeetCommandRuntime,
  type SlashCommandController,
} from "./commands/use-slash-commands.js";
import { TimelineItem } from "./components/TimelineItem.js";
import { MarkdownPolicyContext } from "./components/MarkdownRenderer.js";

/** Public composer options for an anonymous visitor conversation. */
export type ParakeetVisitor = Readonly<{
  /** Agent display name used by the visitor's composer. */
  agentName: string;
}>;

/** Props for the standalone retained conversation surface. */
export type ParakeetProps = Readonly<{
  /** Show short identity suffixes for same-named authors; never in visitor mode. */
  disambiguateAuthors?: boolean | undefined;
  /**
   * Read the author to show from a message's opaque host metadata. Absent,
   * lines show no author.
   */
  authorOf?: ParakeetAuthorOf | undefined;
  /** Visitor mode hides internal readouts and disables slash commands. */
  visitor?: ParakeetVisitor | undefined;
  /** Visitor conversations render Markdown without loading images or unsafe links. */
  markdownPolicy?: "session" | "visitor";
  /** The typed Session client observed by the conversation surface. */
  session: ParakeetSession;
  /** Client entries selected by the host's composition root. */
  clients?: readonly ClientEntryV1[] | undefined;
  /** Optional Caps action style for a host-specific quieter composer. */
  composerActionVariant?: "primary" | "outline" | undefined;
  /** Optional caller-owned actions for a completed tool result. */
  renderToolActions?: ((item: ToolItem) => ReactNode) | undefined;
  /** Optional host claim: true hides this item's image parts from the tool body because the host shows them. */
  claimsToolMedia?: ((item: ToolItem) => boolean) | undefined;
  /** Optional caller-owned attachment below a settled assistant reply. */
  renderAssistantAttachment?: ((text: string) => ReactNode) | undefined;
  /** Optional display text; attachments still receive the original reply. */
  formatAssistantText?: ((text: string) => string) | undefined;
  /** Host navigation for transcript links; true prevents browser navigation. */
  onLink?: ((href: string) => boolean) | undefined;
  /** Authorize and open a typed target through the host's navigation owner. */
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
  /** Optional caller-owned empty conversation state. */
  empty?: ReactNode | undefined;
  /** Optional host Whistle runtime; Parakeet makes its own when omitted. */
  commands?: ParakeetCommandRuntime | undefined;
}>;

/** Props for the reusable retained conversation view. */
export type ParakeetViewProps = Readonly<{
  /** Show short identity suffixes for same-named authors; never in visitor mode. */
  disambiguateAuthors?: boolean | undefined;
  /** Visitor mode hides internal readouts and disables slash commands. */
  visitor?: ParakeetVisitor | undefined;
  /** Optional Caps action style for a host-specific quieter composer. */
  composerActionVariant?: "primary" | "outline" | undefined;
  /** Optional caller-owned actions for a completed tool result. */
  renderToolActions?: ((item: ToolItem) => ReactNode) | undefined;
  /** Optional host claim: true hides this item's image parts from the tool body because the host shows them. */
  claimsToolMedia?: ((item: ToolItem) => boolean) | undefined;
  /** Optional caller-owned attachment below a settled assistant reply. */
  renderAssistantAttachment?: ((text: string) => ReactNode) | undefined;
  /** Optional display text; attachments still receive the original reply. */
  formatAssistantText?: ((text: string) => string) | undefined;
  /** Host navigation for transcript links; true prevents browser navigation. */
  onLink?: ((href: string) => boolean) | undefined;
  /** Authorize and open a typed target through the host's navigation owner. */
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
  /** Optional caller-owned empty conversation state. */
  empty?: ReactNode | undefined;
  /**
   * Optional host Whistle runtime holding the host's own commands. Parakeet
   * adds its built-ins and the Session's advertised commands to it, and makes
   * a private runtime when this is omitted.
   */
  commands?: ParakeetCommandRuntime | undefined;
}>;

/** Render the retained conversation surface within one Parakeet provider. */
export function ParakeetView({
  disambiguateAuthors,
  visitor,
  composerActionVariant,
  empty,
  commands,
  renderToolActions,
  claimsToolMedia,
  renderAssistantAttachment,
  formatAssistantText,
  onLink,
  onOpen,
}: ParakeetViewProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [ownCommands] = useState(() => createWhistle());
  const slash = useSlashCommands({
    enabled: visitor === undefined,
    commands: commands ?? ownCommands,
    origin: "browser",
    keys: { newline: "Shift+Enter" },
    busy: useBusy(),
  });
  const clientActions = useClientActions(commands ?? ownCommands);
  const contributions = useClientContributions();
  const { draft } = useComposer();
  // The decision in the composer is not also a footer row.
  const answering = awaitingTakeover(slash.awaiting, draft)?.key;
  const timelineController = useTimeline();
  const placed = useMemo(
    () =>
      placeClientTimeline(
        contributions,
        timelineController.commandAnchors,
        timelineController.positionAnchors,
      ),
    [
      contributions,
      timelineController.commandAnchors,
      timelineController.positionAnchors,
    ],
  );
  return (
    <div
      className="parakeet flex h-full flex-col items-stretch"
      data-parakeet="standalone"
      data-testid="parakeet-view"
      onClickCapture={(event) => {
        const anchor =
          event.target instanceof Element
            ? event.target.closest("a[href]")
            : null;
        if (anchor instanceof HTMLAnchorElement && onLink?.(anchor.href))
          event.preventDefault();
      }}
    >
      <div className="flex h-full w-full flex-col border-r border-base-300">
        <ConversationTimeline
          disambiguateAuthors={
            visitor === undefined && disambiguateAuthors === true
          }
          clientActions={clientActions}
          onOpen={onOpen}
          focusAfterJump={textareaRef}
          empty={empty}
          renderToolActions={renderToolActions}
          claimsToolMedia={claimsToolMedia}
          renderAssistantAttachment={renderAssistantAttachment}
          formatAssistantText={formatAssistantText}
        />
        {contributions.some(({ entryId, value }) =>
          value.panel.some(
            (row) => JSON.stringify([entryId, row.id]) !== answering,
          ),
        ) ? (
          <section
            aria-label="Session extension controls"
            className="w-full shrink-0 border-t border-base-300 bg-base-100"
          >
            {contributions.map(({ entryId, value: contribution }) => {
              const value = {
                ...contribution,
                panel: contribution.panel.filter(
                  (row) => JSON.stringify([entryId, row.id]) !== answering,
                ),
              };
              // An extension's retained-event notice and null-anchor rows
              // join its own footer entry; one with no panel row here keeps
              // none of this, rather than growing a section just to show it.
              const omittedHere =
                value.panel.length === 0
                  ? undefined
                  : placed.omitted.find((entry) => entry.entryId === entryId);
              const unanchoredHere =
                value.panel.length === 0
                  ? []
                  : placed.unanchored
                      .filter((entry) => entry.entryId === entryId)
                      .flatMap(({ cell }) =>
                        cell.rows.map((row) => ({
                          ...row,
                          id: `unanchored:${cell.id}:${row.id}`,
                        })),
                      );
              return (
                <ClientRows
                  key={entryId}
                  entryId={entryId}
                  rows={[
                    ...value.panel,
                    ...(omittedHere === undefined
                      ? []
                      : [
                          {
                            id: `omitted:${entryId}`,
                            title: `${String(omittedHere.count)} earlier change${omittedHere.count === 1 ? "" : "s"} omitted`,
                            tone: "muted" as const,
                          },
                        ]),
                    ...unanchoredHere,
                  ]}
                  actions={clientActions}
                  onOpen={onOpen}
                />
              );
            })}
          </section>
        ) : null}
        <ConversationWaiting clientActions={clientActions} />
        <ConversationComposer
          visitor={visitor}
          textareaRef={textareaRef}
          composerActionVariant={composerActionVariant}
          slash={slash}
        />
      </div>
      {visitor === undefined ? <ConversationInteraction slash={slash} /> : null}
    </div>
  );
}

const busyStatuses = new Set([
  "cancelling",
  "queued",
  "retrying",
  "sending",
  "streaming",
  "thinking",
]);

function useBusy() {
  return busyStatuses.has(useStatus().status);
}

/** The browser renderer of Parakeet's open command conversation. */
function ConversationInteraction({
  slash,
}: Readonly<{ slash: SlashCommandController }>) {
  const open = slash.interactions.open;
  return (
    <Dialog
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) slash.store.close();
      }}
    >
      <DialogContent
        className="w-[min(32rem,calc(100vw-2rem))] rounded-box bg-base-100 p-md shadow-lg"
        keepMounted={false}
      >
        {open === undefined ? null : (
          <InteractionPanel
            key={open.key}
            host={open.host}
            onClose={slash.store.close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConversationTimeline({
  disambiguateAuthors,
  clientActions,
  onOpen,
  focusAfterJump,
  empty,
  renderToolActions,
  claimsToolMedia,
  renderAssistantAttachment,
  formatAssistantText,
}: Pick<
  ParakeetViewProps,
  | "empty"
  | "renderToolActions"
  | "claimsToolMedia"
  | "renderAssistantAttachment"
  | "formatAssistantText"
  | "disambiguateAuthors"
> & {
  focusAfterJump: RefObject<HTMLTextAreaElement>;
  clientActions: ReturnType<typeof useClientActions>;
  onOpen: ParakeetViewProps["onOpen"];
}) {
  const dismissFailed = useDismissFailedPrompt();
  const timelineController = useTimeline();
  const cancelQueued = useCallback(
    (commandId: string) => {
      void timelineController.cancelQueued(commandId);
    },
    [timelineController.cancelQueued],
  );
  const authorNames = useMemo(
    () =>
      authorDisplayNames(
        disambiguateAuthors
          ? [...timelineController.settled, ...timelineController.tail].flatMap(
              (item) => ("author" in item && item.author ? [item.author] : []),
            )
          : [],
      ),
    [disambiguateAuthors, timelineController.settled, timelineController.tail],
  );
  const contributions = useClientContributions();
  const placed = placeClientTimeline(
    contributions,
    timelineController.commandAnchors,
    timelineController.positionAnchors,
  );
  const before = placed.before.map(({ entryId, cell }) => (
    <ClientRows
      key={`${entryId}:${cell.id}`}
      entryId={entryId}
      rows={cell.rows}
      actions={clientActions}
      onOpen={onOpen}
    />
  ));
  // View-only: kept above the virtualizer so off-screen groups remember it.
  const [toolDisclosure, setToolDisclosure] = useState(initialToolDisclosure);
  const toggleTool = useCallback((id: string, defaultOpen: boolean) => {
    setToolDisclosure((current) => toggleDisclosure(current, id, defaultOpen));
  }, []);
  const sessionStatus = useStatus();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const previousScrollTop = useRef<number | undefined>(undefined);
  const count =
    timelineController.settled.length + timelineController.tail.length;
  const itemAt = useCallback(
    (index: number) =>
      index < timelineController.settled.length
        ? timelineController.settled[index]
        : timelineController.tail[index - timelineController.settled.length],
    [timelineController.settled, timelineController.tail],
  );
  const getItemKey = useTimelineItemKey(
    timelineController.settled,
    timelineController.tail,
  );
  const timeline = useVirtualizer({
    anchorTo: "end",
    count,
    estimateSize: () => 72,
    followOnAppend: "auto",
    getItemKey,
    getScrollElement: () => scrollerRef.current,
    initialRect: { height: 800, width: 800 },
    overscan: 6,
    useFlushSync: false,
  });
  const virtualItems = timeline.getVirtualItems();
  const atBottom = timeline.isAtEnd();
  const [unread, setUnread] = useState(0);
  const lastItem = count > 0 ? itemAt(count - 1)?.id : undefined;
  const observedTail = useRef({ count, lastItem });
  useEffect(() => {
    const previous = observedTail.current;
    observedTail.current = { count, lastItem };
    if (atBottom) setUnread(0);
    else if (previous.lastItem !== undefined && lastItem !== previous.lastItem)
      setUnread((value) => value + Math.max(1, count - previous.count));
  }, [atBottom, count, lastItem]);
  const nearTop = (virtualItems[0]?.index ?? Number.POSITIVE_INFINITY) < 3;
  const {
    hasMoreHistory,
    hasNewerHistory,
    loadingOlderHistory,
    loadOlderHistory,
    loadNewerHistory,
  } = timelineController;
  const requestedAtTop = useRef(false);
  useEffect(() => {
    if (!nearTop) {
      requestedAtTop.current = false;
      return;
    }
    if (hasMoreHistory && !loadingOlderHistory && !requestedAtTop.current) {
      requestedAtTop.current = true;
      loadOlderHistory();
    }
  }, [hasMoreHistory, loadOlderHistory, loadingOlderHistory, nearTop]);

  const jumpToBottom = useCallback(() => {
    setUnread(0);
    previousScrollTop.current = undefined;
    timelineController.jumpToLatest();
    timeline.scrollToEnd({ behavior: "smooth" });
  }, [timeline, timelineController]);

  return (
    <div className="prose relative min-h-0 flex-1">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {sessionReadout(sessionStatus.status, sessionStatus.viewState)}
      </div>
      {sessionStatus.observation.status === "unavailable" ? (
        <div
          className="flex items-center justify-between gap-2 px-3 py-1 text-xs text-dim"
          role="status"
        >
          <span>{sessionStatus.observation.reason}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void sessionStatus.reconnect()}
            type="button"
          >
            Reconnect
          </Button>
        </div>
      ) : null}
      <div
        className="h-full min-h-0 overflow-y-auto"
        data-chat-scroller
        ref={scrollerRef}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          if (
            previousScrollTop.current !== undefined &&
            top < previousScrollTop.current
          )
            timelineController.pinVisibleHistory();
          previousScrollTop.current = top;
        }}
        onWheel={(event) => {
          const scroller = scrollerRef.current;
          if (scroller === null || loadingOlderHistory) return;
          if (event.deltaY < 0) timelineController.pinVisibleHistory();
          if (event.deltaY < 0 && scroller.scrollTop <= 1 && hasMoreHistory)
            loadOlderHistory();
          if (
            event.deltaY > 0 &&
            scroller.scrollTop + scroller.clientHeight >=
              scroller.scrollHeight - 1 &&
            hasNewerHistory
          )
            loadNewerHistory();
        }}
        style={{ overscrollBehavior: "contain" }}
      >
        {count > 0 ? (
          <div
            className="relative w-full"
            style={{ height: `${String(timeline.getTotalSize())}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const item = itemAt(virtualItem.index);
              if (item === undefined) return null;
              return (
                <div
                  data-index={virtualItem.index}
                  data-parakeet-entry={
                    item.kind === "user_message" ? "user" : item.kind
                  }
                  data-parakeet-id={item.id}
                  data-status={
                    item.kind === "assistant_message"
                      ? item.isError
                        ? "error"
                        : undefined
                      : item.kind === "compaction_divider" ||
                          item.kind === "compaction_notice"
                        ? undefined
                        : item.status
                  }
                  data-tone={
                    item.kind === "assistant_message" && item.isError
                      ? "error"
                      : undefined
                  }
                  key={virtualItem.key}
                  ref={timeline.measureElement}
                  style={{
                    left: 0,
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${String(virtualItem.start)}px)`,
                    width: "100%",
                  }}
                >
                  {virtualItem.index === 0 ? before : null}
                  <TimelineItem
                    item={
                      "author" in item &&
                      item.author &&
                      authorNames.has(item.author.id)
                        ? {
                            ...item,
                            author: {
                              ...item.author,
                              name:
                                authorNames.get(item.author.id) ??
                                item.author.name,
                            },
                          }
                        : item
                    }
                    onDismissFailed={dismissFailed}
                    onCancelQueued={cancelQueued}
                    cancellingQueued={timelineController.cancellingQueued}
                    onToggleTool={toggleTool}
                    renderToolActions={renderToolActions}
                    claimsToolMedia={claimsToolMedia}
                    renderAssistantAttachment={renderAssistantAttachment}
                    formatAssistantText={formatAssistantText}
                    toolDisclosure={toolDisclosure}
                  />
                  {placed.after.get(item.id)?.map(({ entryId, cell }) => (
                    <ClientRows
                      key={`${entryId}:${cell.id}`}
                      entryId={entryId}
                      rows={cell.rows}
                      actions={clientActions}
                      onOpen={onOpen}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : before.length > 0 ? (
          before
        ) : hasMoreHistory ? null : (
          (empty ?? (
            <div className="flex h-full items-center justify-center text-center">
              <div>
                <p className="mb-1 text-xs text-base-content">Ready</p>
                <p className="text-[10px] text-dim">
                  What would you like to build?
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      {count > 0 ? (
        <ScrollToBottomBlob
          direction="forward"
          unread={unread}
          focusAfterJump={focusAfterJump}
          onJump={jumpToBottom}
          scrollerRef={scrollerRef}
        />
      ) : null}
    </div>
  );
}

/** Independently contributed waiting controls; queued messages stay in the transcript. */
function ConversationWaiting({
  clientActions,
}: Readonly<{ clientActions: ReturnType<typeof useClientActions> }>) {
  const { viewState } = useStatus();
  const contributions = useClientContributions();
  const extensionWaiting =
    viewState.kind === "idle"
      ? contributions.find(({ value }) => value.waiting !== null)
      : undefined;
  return (
    <>
      {extensionWaiting?.value.waiting === undefined ||
      extensionWaiting.value.waiting === null ? null : (
        <div className="flex items-center gap-2 px-3 text-xs">
          <span>{extensionWaiting.value.waiting.summary}</span>
          <Button
            size="xs"
            variant="outline"
            disabled={
              !clientActions.enabled ||
              clientActions.state.get(extensionWaiting.value.waiting.cancel)
                ?.pending === true
            }
            onClick={() => {
              if (extensionWaiting.value.waiting !== null)
                void clientActions.execute(
                  extensionWaiting.entryId,
                  extensionWaiting.value.waiting.cancel,
                  true,
                );
            }}
          >
            {extensionWaiting.value.waiting.cancel.label}
          </Button>
        </div>
      )}
    </>
  );
}

function ConversationComposer({
  visitor,
  textareaRef,
  composerActionVariant,
  slash,
}: Pick<ParakeetViewProps, "visitor" | "composerActionVariant"> &
  Readonly<{
    slash: SlashCommandController;
    textareaRef: RefObject<HTMLTextAreaElement>;
  }>) {
  const composer = useComposer();
  const sessionStatus = useStatus();
  const contributions = useClientContributions();
  const timeline = useTimeline();
  useEffect(() => {
    if (composer.failure !== undefined) textareaRef.current?.focus();
  }, [composer.failure, textareaRef]);
  const abort = useCallback(() => {
    void composer.cancel();
  }, [composer.cancel]);
  const composerProps: ChatComposerProps = {
    queuedRecall: visitor === undefined ? composer : undefined,
    onImagesChange: visitor === undefined ? composer.setImages : undefined,
    statusChips: contributions
      .flatMap(({ value }) => value.chips)
      .sort((left, right) => left.order - right.order)
      .map(({ row }) => row.title),
    actionVariant: composerActionVariant,
    draft: composer.draft,
    failure: composer.failure,
    failureCause:
      sessionStatus.viewState.kind === "error"
        ? sessionStatus.viewState.cause
        : undefined,
    admissionError: composer.admissionError,
    onAbort: abort,
    onChange: composer.setDraft,
    onRetry: composer.retry,
    onSend: slash.submit,
    slash: visitor === undefined ? slash : undefined,
    placeholder:
      visitor === undefined ? undefined : `Ask ${visitor.agentName}…`,
    showFooter: visitor === undefined,
    status: sessionStatus.status,
    viewState: sessionStatus.viewState,
    textareaRef,
    model: timeline.model,
    usage: timeline.usage,
    context: sessionStatus.context,
  };
  return <ChatComposer {...composerProps} />;
}

/** Standalone typed composer and exact-message timeline. */
export function Parakeet({
  authorOf,
  disambiguateAuthors,
  visitor,
  markdownPolicy = "session",
  composerActionVariant,
  empty,
  session,
  clients,
  renderToolActions,
  claimsToolMedia,
  renderAssistantAttachment,
  formatAssistantText,
  commands,
  onLink,
  onOpen,
}: ParakeetProps): ReactElement {
  return (
    <MarkdownPolicyContext.Provider value={markdownPolicy}>
      <ParakeetProvider session={session} clients={clients} authorOf={authorOf}>
        <ParakeetView
          disambiguateAuthors={disambiguateAuthors}
          visitor={visitor}
          composerActionVariant={composerActionVariant}
          empty={empty}
          renderToolActions={renderToolActions}
          claimsToolMedia={claimsToolMedia}
          renderAssistantAttachment={renderAssistantAttachment}
          formatAssistantText={formatAssistantText}
          commands={commands}
          onLink={onLink}
          onOpen={onOpen}
        />
      </ParakeetProvider>
    </MarkdownPolicyContext.Provider>
  );
}
