import { expect, it } from "vitest";
import { formatContextUsage, formatModelIdentity } from "../src/headless.js";

it.each([
  ["openai", "gpt-6-astra", "openai/gpt-6-astra"],
  ["openai", "openai/gpt-6-luna", "openai/gpt-6-luna"],
  ["anthropic", "claude-sonnet", "anthropic/claude-sonnet"],
  ["fungi", "openai/gpt-6-astra", "fungi/openai/gpt-6-astra"],
])("formats the durable ids for %s", (provider, model, expected) => {
  expect(formatModelIdentity({ provider, model })).toBe(expected);
});

it.each([
  [12_345, 200_000, "12K/200K"],
  [850, 128_000, "850/128K"],
  [431_000, 1_048_576, "431K/1M"],
  [1_250_000, 2_000_000, "1.3M/2M"],
  [12_345, null, "12K"],
] as const)("formats %i of %s context tokens", (tokens, window, expected) => {
  expect(formatContextUsage({ tokens, window })).toBe(expected);
});
