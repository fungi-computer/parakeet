import type {
  AccountOwner,
  LoginPolicy,
  LoginProvider,
} from "../../src/account-commands.js";

/** Representative registry data, as the Local owner derives it from Pi. */
export const fixtureProviders: readonly LoginProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      { kind: "api_key", label: "OpenAI API key" },
      { kind: "subscription", label: "Sign in with ChatGPT" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    methods: [
      { kind: "api_key", label: "Anthropic API key" },
      { kind: "subscription", label: "Claude Pro/Max" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    methods: [{ kind: "api_key", label: "OpenRouter API key" }],
  },
];

/** Stand-in for the credential policy module's `loginAllowed`. */
export const fixturePolicy: LoginPolicy = {
  loginAllowed: ({ providerId, method, host }) =>
    method === "api_key" || (host === "local" && providerId !== "anthropic"),
};

/** An owner whose subscription sign-in waits until `approve` is called. */
export function fixtureAccountOwner() {
  const approval = new AbortController();
  const approved = new Promise((resolve) => {
    approval.signal.addEventListener("abort", resolve, { once: true });
  });
  const owner: AccountOwner = {
    popularProviderIds: ["openai", "anthropic", "openrouter"],
    access: () => Promise.resolve([]),
    providers: () => Promise.resolve(fixtureProviders),
    login: async (request, interaction) => {
      if (request.method === "api_key") {
        await interaction.prompt({
          type: "text",
          message: "Paste your API key",
          secret: true,
        });
        return;
      }
      interaction.notify({
        type: "handoff",
        url: "https://auth.example.test/device",
        code: "WDJB-MJHT",
      });
      interaction.notify({ type: "progress", message: "Waiting for sign-in…" });
      await approved;
    },
    logout: () => Promise.resolve(),
    status: () => Promise.resolve("OpenAI: API key"),
  };
  return {
    owner,
    approve: () => {
      approval.abort();
    },
  };
}
