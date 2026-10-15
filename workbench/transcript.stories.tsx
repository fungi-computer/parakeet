import type { StoryDefault } from "@ladle/react";

import { TimelineItem } from "../src/components/TimelineItem.js";
import type { TimelineItem as TimelineRow } from "../src/store/types.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Transcript" } satisfies StoryDefault;

const start = Date.UTC(2026, 8, 30, 15, 41, 0);

const settled: readonly TimelineRow[] = [
  {
    id: "ask",
    kind: "user_message",
    status: "confirmed",
    at: start,
    text: "Can you make me a game where a mushroom catches raindrops?",
  },
  {
    id: "answer",
    kind: "assistant_message",
    pending: false,
    at: start + 6_000,
    thinking: "A catcher, falling drops, a score. Keep it small and quick.",
    text: "Yes. I'll start with a garden, one mushroom and a rainy sky. Arrow keys slide the cap left and right; every drop you catch grows the cap a little.",
  },
  {
    id: "again",
    kind: "user_message",
    status: "confirmed",
    at: start + 90_000,
    text: "Make the rain slower, please.",
  },
];

function Transcript({ items }: Readonly<{ items: readonly TimelineRow[] }>) {
  return (
    <div className="parakeet prose mx-auto w-full max-w-[48rem] py-md">
      {items.map((item) => (
        <div data-parakeet-entry={item.kind} key={item.id}>
          <TimelineItem item={item} />
        </div>
      ))}
    </div>
  );
}

/** One column, a user rail and plain Agent text. */
export const Turns = () => <Transcript items={settled} />;

/** A reply still being written: its head thinks, the time says so, dots trail the text. */
export const Streaming = () => (
  <Transcript
    items={[
      ...settled,
      {
        id: "writing",
        kind: "assistant_message",
        pending: true,
        text: "Slower rain, coming up. I'm turning the fall speed down and giving the",
      },
    ]}
  />
);

/** The moment after sending, before any words: just the dots. */
export const Opening = () => (
  <Transcript
    items={[
      ...settled,
      { id: "opening", kind: "assistant_message", pending: true, text: "" },
    ]}
  />
);

/** A turn that did not finish reads as one. */
export const Failed = () => (
  <Transcript
    items={[
      ...settled,
      {
        id: "failed",
        kind: "assistant_message",
        pending: false,
        isError: true,
        at: start + 100_000,
        text: "I lost my place halfway through. Send that again and I'll pick it back up.",
      },
    ]}
  />
);

const markdown = [
  "---",
  "title: Chat content stays visible",
  "---",
  "## Garden notes",
  "",
  "A **small garden** with *slow rain*, ~~old plans~~ and `inline code`.",
  "",
  "> Keep the mushroom under the rain.",
  "",
  "- Catch the drops.",
  "- Grow the cap.",
  "",
  "1. Move left.",
  "2. Move right.",
  "",
  "| Control | Action |",
  "| --- | --- |",
  "| Arrow keys | Move the cap |",
  "",
  "```tsx",
  "const garden = <Mushroom rain={true} />;",
  "```",
  "",
  "```sql",
  "SELECT cap FROM garden WHERE rain = true;",
  "```",
  "",
  "```dockerfile",
  "FROM node:24",
  "WORKDIR /garden",
  "```",
  "",
  "[Notes](https://example.com/notes) and [local plans](/garden/plan).",
  "",
  "![Generated garden](/garden.png)",
].join("\n");

/** Every chat Markdown treatment, including expanded thoughts and code languages. */
export const Markdown = () => (
  <Transcript
    items={[
      {
        id: "ask",
        kind: "user_message",
        status: "confirmed",
        text: "Show **garden notes** and `controls`.",
      },
      {
        id: "markdown",
        kind: "assistant_message",
        pending: false,
        thinking: "Keep **formatting** and `code` in thoughts too.",
        text: markdown,
      },
    ]}
  />
);

/** A streamed response may end inside a fenced code block. */
export const PartialMarkdown = () => (
  <Transcript
    items={[
      {
        id: "partial",
        kind: "assistant_message",
        pending: true,
        text: "**Slower rain**, coming up.\n\n```ts\nconst rain = { speed: 0.5,",
      },
    ]}
  />
);
