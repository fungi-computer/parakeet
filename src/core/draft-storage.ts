import { z } from "zod";
import { reportFailure } from "../lib/failure.js";

const images = z
  .array(
    z.object({
      type: z.literal("image"),
      data: z.string(),
      mimeType: z.string(),
    }),
  )
  .readonly();
const delivery = z.enum(["steer", "followUp"]);
const recalledPrompt = z.object({
  commandId: z.string(),
  requestId: z.string(),
  text: z.string(),
  images: images.optional(),
  delivery,
});
/** Durable owner identity, independent of the current service endpoint. */
export type ParakeetDraftIdentity = Readonly<{
  /** Agent that owns the Session. */
  agentId: string;
  /** Durable Session identity, not its transport address. */
  sessionId: string;
}>;

/** Hosts must commit a replacement before returning, or throw without changing it. */
export type ParakeetDraftStorage = Readonly<{
  /** Read the complete journal, or null when no draft has been saved. */
  getItem: (key: string) => string | null;
  /** Atomically replace the journal; throw if it cannot be committed. */
  setItem: (key: string, value: string) => void;
  /** Remove a journal, doing nothing when the key is absent. */
  removeItem: (key: string) => void;
}>;

const pendingDraft = z.object({
  status: z.enum(["queued-local", "admitting"]),
  requestId: z.string().min(1),
  content: z.string(),
  submittedDraft: z.string(),
  delivery,
  images: images.optional(),
  restoreDraft: z.boolean(),
});
const journal = z.object({
  draft: z.string(),
  images: images.optional(),
  delivery: delivery.optional(),
  recall: recalledPrompt.optional(),
  pending: z.array(pendingDraft).max(32),
});
type DraftJournal = z.infer<typeof journal>;

/** One owner-scoped journal commits pending text and composer text together. */
export function draftJournal(
  scope: string,
  storage: ParakeetDraftStorage | undefined,
) {
  const key = `fungi.parakeet.drafts.v2:${scope}`;
  let discardObsolete = true;
  return {
    read(): DraftJournal {
      if (storage === undefined) return { draft: "", pending: [] };
      if (discardObsolete) {
        discardObsolete = false;
        try {
          // Delete preview data without interpreting its superseded grammar.
          storage.removeItem(`fungi.parakeet.drafts.v1:${scope}`);
        } catch (cause) {
          reportFailure("discard obsolete draft journal", cause);
        }
      }
      try {
        const saved = storage.getItem(key);
        return saved === null
          ? { draft: "", pending: [] }
          : journal.parse(JSON.parse(saved));
      } catch (cause) {
        // Preview journals are disposable; a broken load must not break chat.
        reportFailure("read saved draft", cause);
        return { draft: "", pending: [] };
      }
    },
    write(value: DraftJournal): void {
      if (storage === undefined)
        throw new Error("Durable draft storage is unavailable");
      storage.setItem(key, JSON.stringify(value));
    },
  };
}
