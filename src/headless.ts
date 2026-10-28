export {
  formatModelIdentity,
  formatModelWithLevel,
} from "./core/model-identity.js";
export type {
  QueuedRecallState,
  QueuedRecallOutcome,
} from "./core/queued-recall.js";
export type {
  ParakeetDraftIdentity,
  ParakeetDraftStorage,
} from "./core/draft-storage.js";
export { formatContextUsage, formatTokenCount } from "./core/format-context.js";
export { formatWhen, oneLine } from "./core/picker-text.js";
export { providerChoices } from "./provider-choices.js";
export {
  ParakeetProvider,
  useComposer,
  useClientContributions,
  useParakeetInteractions,
  useExtensionSlots,
  useParakeetSession,
  useLastSessionReplyAt,
  useStatus,
  useTimeline,
  type ComposerController,
  type ParakeetDraftCheckpoint,
  type ParakeetModel,
  type ParakeetObservation,
  type ParakeetReconnectOutcome,
  type ParakeetStatus,
  type ParakeetSessionViewState,
  type ParakeetUsage,
  type StatusController,
  type TimelineController,
} from "./conversation.js";
export {
  sessionViewState,
  queuedSessionLabel,
  sessionActivityStatus,
  type SessionActivityStatus,
  type SessionViewFacts,
  type SessionViewState as ParakeetOwnerViewState,
} from "./core/session-view-state.js";
export { mergeTerminals } from "./core/session-projection.js";
export {
  type SessionActivity,
  seedSessionQuery,
  sessionQueryOptions,
  subscribeSessionActivity,
} from "./core/session-query.js";
export {
  accountCommandDefinitions,
  contributeAccountCommands,
  loginRegistry,
  type AccountCommandOptions,
  type AccountOwner,
  type ProviderAccess,
  type ModelAccountContext,
  type LoginHost,
  type LoginMethod,
  type LoginMethodKind,
  type LoginPolicy,
  type LoginProvider,
  type LoginScope,
} from "./account-commands.js";
export {
  contributeModelCommands,
  sessionModelCommandDefinitions,
  type SessionModelChoice,
  type SessionModelCommandOptions,
} from "./model-commands.js";
export {
  contributeReloadCommand,
  reloadCommandDefinitions,
  reloadSources,
  type ReloadCommandOptions,
  type ReloadSource,
} from "./reload-command.js";
export {
  contributeSessionCommands,
  type ParakeetSessionCommandOptions,
} from "./session-commands.js";
export {
  completeSlash,
  fuzzyMatch,
  keyBindings,
  keyLabel,
  parseSlashDraft,
  slashRegistry,
  type FuzzyMatch,
  type KeyBindingRow,
  type SlashCommand,
  type SlashCommandItem,
  type SlashCompletion,
  type SlashParse,
  type SlashWordItem,
} from "./commands/slash.js";
export {
  composerHints,
  fitHints,
  formatHints,
  type ComposerHintContext,
  type ComposerKeys,
  type KeyHint,
} from "./commands/hints.js";
export {
  isCancelledOutcome,
  runSlashDraft,
  type SlashRuntime,
} from "./commands/run.js";
export {
  createParakeetInteractions,
  type ParakeetInteractions,
  type ParakeetAwaiting,
  type ParakeetInteractionState,
  type ParakeetNotice,
  type ParakeetOpenInteraction,
  type ParakeetToast,
} from "./commands/interactions.js";
export {
  parakeetBuiltinCommands,
  type ParakeetBuiltinOptions,
} from "./commands/builtins.js";
export {
  advertisedCommands,
  type AdvertisedCatalogError,
  type AdvertisedCommands,
} from "./commands/advertised.js";
export {
  useSlashCommands,
  type ParakeetCommandRuntime,
  type SlashCommandController,
  type SlashCommandOptions,
} from "./commands/use-slash-commands.js";
export type {
  ParakeetSession,
  ParakeetSessionCommand,
  ParakeetPromptResult,
} from "./session.js";
export type {
  AssistantMessageItem as ParakeetAssistantMessageItem,
  TimelineItem as ParakeetTimelineItem,
  ToolGroupItem as ParakeetToolGroupItem,
  ToolItem as ParakeetToolItem,
  UserMessageItem as ParakeetUserMessageItem,
} from "./store/types.js";
export type { ToolArguments as ParakeetToolArguments } from "./core/tool-contract.js";
export {
  useMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from "./markdown.js";
export {
  formatToolDuration,
  toolCallView,
  toolKindSigils,
  toolStatusTone,
  type ToolCallSection as ParakeetToolCallSection,
  type ToolCallView as ParakeetToolCallView,
  type ToolDiffFile as ParakeetToolDiffFile,
  type ToolDiffHunk as ParakeetToolDiffHunk,
  type ToolDiffLine as ParakeetToolDiffLine,
  type ToolDiffRow as ParakeetToolDiffRow,
  type ToolExcerptLine as ParakeetToolExcerptLine,
  type ToolKind as ParakeetToolKind,
  type ToolMatch as ParakeetToolMatch,
  type ToolOutputLine as ParakeetToolOutputLine,
} from "./core/tool-view.js";
export { assistantMessageVisible } from "./core/assistant-visibility.js";
export {
  disclosureOpen,
  initialToolDisclosure,
  toggleAllDisclosure,
  toggleDisclosure,
  toolCallDefaultOpen,
  toolGroupDefaultOpen,
  visibleToolCalls,
  type ToolDisclosureState,
} from "./core/tool-groups.js";

export { useClientActions } from "./client-contributions.js";
export {
  awaitingQueue,
  awaitingTakeover,
  decisionView,
  decisionViewText,
  initialDecisionState,
  reduceDecision,
  type AwaitingItem,
  type AwaitingKind,
  type AwaitingQueue,
  type DecisionEffect,
  type DecisionIntent,
  type DecisionOutcome,
  type DecisionPhase,
  type DecisionPrompt,
  type DecisionRowView,
  type DecisionState,
  type DecisionView,
} from "./core/awaiting-answer.js";
export { useDecision, type DecisionController } from "./use-decision.js";
export { useApprovalAwaiting } from "./use-approval-awaiting.js";
export {
  approvalCardCopy,
  approvalRefusal,
  askApproval,
  type ApprovalAbandoned,
  type ApprovalAnswered,
  type ApprovalAnswerInput,
  type ApprovalAnswerResult,
  type ApprovalCard,
  type ApprovalContent,
  type ApprovalDecision,
  type ApprovalEntry,
  type ApprovalFacts,
  type ApprovalOutcome,
  type ApprovalRefused,
  type ApprovalReview,
  type ApprovalSource,
} from "./core/approval-decision.js";
export {
  placeClientTimeline,
  type PlacedClientCell,
} from "./core/client-timeline.js";
export type { ClientContribution } from "./core/client-contributions.js";
