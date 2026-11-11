import type { AssistantMessageItem } from "../store/types.js";

/**
 * Whether reasoning text shows anything a reader can see. Whitespace and
 * invisible format characters (zero-width spaces and joiners, byte-order
 * marks) are not text; a thinking row made only of them renders nothing.
 */
export function hasVisibleReasoning(thinking: string | undefined): boolean {
  return thinking !== undefined && /[^\s\p{Cf}]/u.test(thinking);
}

/** One rule for whether an assistant row has content either renderer shows. */
export function assistantMessageVisible(item: AssistantMessageItem): boolean {
  return item.text.trim() !== "" || hasVisibleReasoning(item.thinking);
}
