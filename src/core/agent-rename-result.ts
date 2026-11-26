import { avatarEnvelopeSchema } from "@fungi.computer/sprite/avatar";
import { z } from "zod";

import type { ToolItem } from "../store/types.js";

/** What `self.rename` returns: the Agent's new name and the avatar it wears. */
export const renameResult = z.strictObject({
  name: z.string().min(1).max(256),
  avatar: avatarEnvelopeSchema,
});

/** The result text of a call, or undefined when it has none. */
function resultText(result: ToolItem["result"]): string | undefined {
  if (result === undefined) return undefined;
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return text.trim() === "" ? undefined : text;
}

/**
 * Whether a completed call's result is the one `self.rename` returns, wherever
 * in its script the rename ran. A host uses this only to refresh the Agent's
 * name; the row's identity label stays limited to a call that is just the rename.
 * Kept apart from the tool view so a host that only watches for renames does
 * not load the view's script parser and diff engine.
 */
export function returnsAgentRename(item: ToolItem): boolean {
  if (item.status !== "completed") return false;
  const text = resultText(item.result);
  if (text === undefined) return false;
  try {
    // A bare JSON string is text, never the rename object, so it fails here.
    return renameResult.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
}
