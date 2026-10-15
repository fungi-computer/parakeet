import type {
  ShiitakeSession,
  Accepted,
  CancelResult,
  ForkedSession,
  PromptCommand,
  CompactCommand,
  CancelCommand,
  AbortCommand,
  BranchCommand,
  OperatorCommand,
  TitleCommand,
  ForkCommand,
  SessionCommand,
} from "@fungi.computer/shiitake/client";

/** A prompt may be recorded for a human without admitting Agent work. */
export type ParakeetPromptResult =
  | Accepted
  | Readonly<{
      /** The owner stored this prompt without starting Agent work. */
      status: "recorded";
    }>;

/** Session commands preserve their owner results, including held visitor lines. */
export type ParakeetSessionCommand = {
  /** Admit Agent work or record a prompt held for a human reply. */
  (input: PromptCommand | CompactCommand): Promise<ParakeetPromptResult>;
  /** Cancel the named queued or running command. */
  (input: CancelCommand): Promise<CancelResult>;
  /** Forward an owner-supported Session control command. */
  (
    input: AbortCommand | BranchCommand | OperatorCommand | TitleCommand,
  ): Promise<undefined>;
  /** Return the owner-issued address of a forked Session. */
  (input: ForkCommand): Promise<ForkedSession>;
  /** Dispatch a typed command without inventing an admission result. */
  (
    input: SessionCommand,
  ): Promise<ParakeetPromptResult | CancelResult | ForkedSession | undefined>;
};

/** The exact Shiitake operations consumed by the retained conversation UI. */
export type ParakeetSession = Readonly<
  Pick<ShiitakeSession, "address" | "extension" | "read" | "watch"> & {
    /** Submit commands through this Session's admitted owner boundary. */
    command: ParakeetSessionCommand;
  }
>;
