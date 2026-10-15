import type { AssistantMessageItem } from "../store/types.js";

/** One rule for whether an assistant row has content either renderer shows. */
export function assistantMessageVisible(item: AssistantMessageItem): boolean {
  return item.text.trim() !== "" || (item.thinking?.trim() ?? "") !== "";
}
