import { z } from "zod";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import type {
  ClientDescribedLineV1,
  ClientEntryV1,
} from "@fungi.computer/shiitake/client-entry";
import type { TimelineItem } from "../store/types.js";

/** One description read: the short line, or none. */
type Described = Readonly<{
  text: string | undefined;
  own: boolean;
}>;

const shortText = z.string().min(1).max(500);
const describedLine = z.union([
  shortText.transform((text) => ({ text, own: false })),
  z.object({ text: shortText, own: z.boolean() }),
]);

/**
 * Replace the display of messages the producing extension's client can describe;
 * the Agent's text is untouched. A client entry reads its own slot only, and it
 * is installed code: a hook that throws, or returns anything but a short string,
 * leaves the original message and is reported once, like a failing contribution.
 */
export function describeMessages(
  items: readonly TimelineItem[],
  clients: readonly ClientEntryV1[],
  slots: SessionExtensionSlots,
  failed: (entryId: string, cause: unknown) => void,
): readonly TimelineItem[] {
  const describers = new Map<
    string,
    NonNullable<ClientEntryV1["describeMessage"]>
  >();
  const toolDescribers: {
    entryId: string;
    describe: NonNullable<ClientEntryV1["describeToolCall"]>;
  }[] = [];
  for (const entry of clients) {
    if (entry.describeMessage !== undefined)
      describers.set(entry.id, entry.describeMessage);
    if (entry.describeToolCall !== undefined)
      toolDescribers.push({
        entryId: entry.id,
        describe: entry.describeToolCall,
      });
  }
  if (describers.size === 0 && toolDescribers.length === 0) return items;
  // A short line from installed code, or undefined; a bad one is reported once.
  const line = (
    entryId: string,
    read: () => ClientDescribedLineV1 | undefined,
  ): Described => {
    try {
      const described = read();
      if (described === undefined) return { text: undefined, own: false };
      const parsed = describedLine.safeParse(described);
      if (parsed.success) return parsed.data;
      failed(entryId, new Error("Message description is not a short string"));
      return { text: undefined, own: false };
    } catch (cause) {
      failed(entryId, cause);
      return { text: undefined, own: false };
    }
  };
  return items.flatMap((item): readonly TimelineItem[] => {
    if (item.kind === "tool_group") {
      // The person's answer to a tool call stands as their own message after
      // the group that holds the call, or in its place.
      const answers = item.tools.flatMap((tool): readonly TimelineItem[] => {
        for (const { entryId, describe } of toolDescribers) {
          const { text, own } = line(entryId, () =>
            describe(tool.id, slots[entryId]),
          );
          if (text !== undefined)
            return [
              {
                id: `answer:${tool.id}`,
                kind: "user_message",
                status: "confirmed",
                text,
                outcome: own ? "own" : "system",
              },
            ];
        }
        return [];
      });
      if (answers.length === 0) return [item];
      // A group of nothing but answered questions is a "Ran script ..." row a
      // new person cannot read; their answer says what happened, so it stands
      // alone. Any other group keeps its calls.
      if (answers.length !== item.tools.length || item.failedCount !== 0)
        return [item, ...answers];
      // The last answer takes the group's identity, so a client cell anchored
      // after the group still renders after the answer.
      return answers.map((answer, at) =>
        at === answers.length - 1 ? { ...answer, id: item.id } : answer,
      );
    }
    if (item.kind !== "user_message" || item.origin === undefined)
      return [item];
    const origin = item.origin;
    const entryId = origin.extensionId;
    const describe = describers.get(entryId);
    if (describe === undefined) return [item];
    const { text, own } = line(entryId, () => describe(origin, slots[entryId]));
    return text === undefined
      ? [item]
      : [{ ...item, text, outcome: own ? "own" : "system" }];
  });
}
