import { expect, it } from "vitest";
import { providerChoices } from "../src/provider-choices.js";
import type { LoginProvider, ProviderAccess } from "../src/account-commands.js";

const popular = [
  "fungi",
  "openai",
  "anthropic",
  "deepseek",
  "kimi-coding",
  "openrouter",
];
const providers: readonly LoginProvider[] = [
  { id: "zeta", name: "Zeta", methods: [] },
  {
    id: "deepseek",
    name: "DeepSeek",
    methods: [{ kind: "api_key", label: "API key" }],
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: [{ kind: "subscription", label: "Sign in with ChatGPT" }],
  },
  { id: "kimi-coding", name: "Kimi For Coding", methods: [] },
  { id: "alpha", name: "Alpha", methods: [] },
  { id: "fungi", name: "Fungi", methods: [] },
];
const access: readonly ProviderAccess[] = [
  { providerId: "zeta", providerName: "Zeta", type: "api_key" },
  { providerId: "alpha", providerName: "Alpha", type: "api_key" },
  { providerId: "openai", providerName: "OpenAI", type: "oauth" },
];
it("orders signed-in providers by popularity then name, and retains Pi's labels", () => {
  expect(
    providerChoices(providers, access, popular, "login").map(
      ({ value, label, group }) => ({ value, label, group }),
    ),
  ).toEqual([
    { value: "openai", label: "OpenAI", group: "Signed in" },
    { value: "alpha", label: "Alpha", group: "Signed in" },
    { value: "zeta", label: "Zeta", group: "Signed in" },
    { value: "fungi", label: "Fungi", group: "Popular" },
    { value: "deepseek", label: "DeepSeek", group: "Popular" },
    { value: "kimi-coding", label: "Kimi For Coding", group: "Popular" },
  ]);
});
it("keeps signed-out Fungi first and visible above configured and collapsed providers", () => {
  const rows = providerChoices(
    [...providers, ...providers],
    access,
    popular,
    "model",
  );
  expect(rows.map((row) => [row.value, row.group])).toEqual([
    ["fungi", "Default"],
    ["openai", "Signed in"],
    ["alpha", "Signed in"],
    ["zeta", "Signed in"],
    ["deepseek", "More providers"],
    ["kimi-coding", "More providers"],
  ]);
  expect(rows.find((row) => row.value === "zeta")?.description).toBe("API key");
});

it("keeps configured Fungi first in Signed in", () => {
  const rows = providerChoices(
    providers,
    [...access, { providerId: "fungi", providerName: "Fungi", type: "oauth" }],
    popular,
    "model",
  );
  expect(rows[0]).toMatchObject({ value: "fungi", group: "Signed in" });
});
