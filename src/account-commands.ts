import {
  WhistleActionError,
  type WhistleContribution,
  type WhistleContributionLease,
  type WhistleExecutionInput,
  type WhistleInteraction,
  type WhistleRuntime,
  type WhistlePrompt,
} from "@fungi.computer/whistle";
import { z } from "zod";
import { providerChoices } from "./provider-choices.js";

/** How a person proves they may use a provider: an API key or their subscription sign-in. */
export type LoginMethodKind = "api_key" | "subscription";

/** One sign-in method a provider offers, labelled by its owner. */
export type LoginMethod = Readonly<{
  /** API key or subscription sign-in. */
  kind: LoginMethodKind;
  /** Provider-supplied label, e.g. "Anthropic API key". */
  label: string;
}>;

/** One model provider in the registry. Names come from data, never code. */
export type LoginProvider = Readonly<{
  /** Stable provider identity, e.g. a Pi provider id. */
  id: string;
  /** Provider-supplied display name. */
  name: string;
  /** Sign-in methods this provider offers. */
  methods: readonly LoginMethod[];
}>;

/** Where the credential will be used: the person's machine or Fungi's servers. */
export type LoginHost = "local" | "hosted";

/** Whose credential it is: one person, or a Team. */
export type LoginScope = "user" | "team";

/**
 * The credential policy owner's decision, the same shape as
 * `@fungi.computer/veil/model-credentials` `loginAllowed`. Login offers only
 * what it permits.
 */
export type LoginPolicy = Readonly<{
  /** Whether this method may be offered for this provider, host and scope. */
  loginAllowed: (
    request: Readonly<{
      providerId: string;
      method: LoginMethodKind;
      host: LoginHost;
      scope: LoginScope;
    }>,
  ) => boolean;
}>;

/** The providers and methods one surface may offer, in display order. */
export function loginRegistry(
  providers: readonly LoginProvider[],
  options: Readonly<{
    policy: LoginPolicy;
    host: LoginHost;
    scope: LoginScope;
  }>,
): readonly LoginProvider[] {
  return providers
    .map((provider): LoginProvider => ({
      ...provider,
      methods: provider.methods.filter((method) =>
        options.policy.loginAllowed({
          providerId: provider.id,
          method: method.kind,
          host: options.host,
          scope: options.scope,
        }),
      ),
    }))
    .filter((provider) => provider.methods.length > 0)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

/** A configured provider reported by the credential owner, without secrets. */
export type ProviderAccess = Readonly<{
  /** Stable registry identity. */
  providerId: string;
  /** Provider-owned display label. */
  providerName: string;
  /** The configured credential kind. */
  type: "oauth" | "api_key";
}>;

/** The credential owner behind the account commands. */
export type AccountOwner = Readonly<{
  /** Host-owned popular order, shared by account and model choices. */
  popularProviderIds: readonly string[];
  /** Configured provider access from the credential owner's parsed status. */
  access: (signal: AbortSignal) => Promise<readonly ProviderAccess[]>;
  /** Every provider the owner can sign in to, before policy. */
  providers: (signal: AbortSignal) => Promise<readonly LoginProvider[]>;
  /** Run the provider's own sign-in; it may prompt and notify. */
  login: (
    request: Readonly<{
      providerId: string;
      method: LoginMethodKind;
      /** Provider-specific choice, e.g. a device-code flow. */
      option?: string;
    }>,
    interaction: WhistleInteraction,
  ) => Promise<void>;
  /** Remove the provider's stored credential. */
  logout: (
    providerId: string,
    interaction: WhistleInteraction,
  ) => Promise<void>;
  /** A short human summary of configured providers. */
  status: (signal: AbortSignal) => Promise<string>;
}>;

/** Contribution identity and the policy context for account commands. */
export type AccountCommandOptions = Readonly<{
  /** Host source that owns the contribution lease. */
  sourceId: string;
  /** Namespace for the account commands. */
  namespace: string;
  /** Where credentials signed in here will be used. */
  host: LoginHost;
  /** Whose credentials they are. */
  scope: LoginScope;
  /** The credential policy owner's decision. */
  policy: LoginPolicy;
}>;

/** One account owner and its credential policy context for an interactive model picker. */
export type ModelAccountContext = Pick<
  AccountCommandOptions,
  "policy" | "host" | "scope"
> &
  Readonly<{
    /** Existing credential owner, also used by the account commands. */
    owner: AccountOwner;
  }>;

const loginArguments = z.strictObject({
  providerId: z.string().min(1).max(200).optional(),
  method: z.enum(["api_key", "subscription"]).optional(),
  option: z.string().min(1).max(200).optional(),
});
const loginArgumentsSchema = z
  .record(z.string(), z.json())
  .parse(structuredClone(z.toJSONSchema(loginArguments)));
const logoutArguments = z.strictObject({
  providerId: z.string().min(1).max(200).optional(),
});
const logoutArgumentsSchema = z
  .record(z.string(), z.json())
  .parse(structuredClone(z.toJSONSchema(logoutArguments)));

function methodDescription(method: LoginMethod, provider: LoginProvider) {
  return method.kind === "api_key"
    ? "Paste an API key you created"
    : `Sign in with your ${provider.name} account`;
}

function requireInteraction(input: WhistleExecutionInput) {
  if (input.interaction === undefined)
    throw new WhistleActionError(
      "interaction_required",
      "Signing in needs an interactive client.",
    );
  return input.interaction;
}

async function chooseProvider(
  providers: readonly LoginProvider[],
  requested: string | undefined,
  interaction: WhistleInteraction,
  message: string,
  choices: Extract<WhistlePrompt, { type: "choice" }>["options"],
) {
  if (requested !== undefined) {
    const provider = providers.find((candidate) => candidate.id === requested);
    if (provider === undefined)
      throw new WhistleActionError(
        "unknown_provider",
        `${requested} is not available here.`,
      );
    return provider;
  }
  if (providers.length === 0)
    throw new WhistleActionError(
      "no_providers",
      "No model providers are available here.",
    );
  const id = await interaction.prompt({
    type: "choice",
    message,
    collapsedGroup: "More providers",
    options: choices,
  });
  const provider = providers.find((candidate) => candidate.id === id);
  if (provider === undefined)
    throw new WhistleActionError("unknown_provider", `${id} is unavailable.`);
  return provider;
}

async function chooseMethod(
  provider: LoginProvider,
  requested: LoginMethodKind | undefined,
  interaction: WhistleInteraction,
) {
  if (requested !== undefined) {
    const method = provider.methods.find((one) => one.kind === requested);
    if (method === undefined)
      throw new WhistleActionError(
        "method_unavailable",
        `${provider.name} does not offer that sign-in method here.`,
      );
    return method;
  }
  const [only, ...rest] = provider.methods;
  if (only !== undefined && rest.length === 0) return only;
  const kind = await interaction.prompt({
    type: "choice",
    message: `How do you want to sign in to ${provider.name}?`,
    options: provider.methods.map((method) => ({
      value: method.kind,
      label: method.label,
      description: methodDescription(method, provider),
    })),
  });
  const method = provider.methods.find((one) => one.kind === kind);
  if (method === undefined)
    throw new WhistleActionError(
      "method_unavailable",
      "Choose a listed method.",
    );
  return method;
}

/** Run the existing provider-owned sign-in after the caller applies credential policy. */
export async function signInProvider(
  owner: AccountOwner,
  provider: LoginProvider,
  interaction: WhistleInteraction,
  request: Readonly<{
    method?: LoginMethodKind | undefined;
    option?: string | undefined;
  }> = {},
): Promise<void> {
  const method = await chooseMethod(provider, request.method, interaction);
  interaction.notify({
    type: "progress",
    message: `Signing in to ${provider.name}…`,
  });
  await owner.login(
    request.option === undefined
      ? { providerId: provider.id, method: method.kind }
      : {
          providerId: provider.id,
          method: method.kind,
          option: request.option,
        },
    interaction,
  );
  interaction.notify({
    type: "success",
    message: `Signed in to ${provider.name}.`,
  });
}

async function signOutProvider(
  owner: AccountOwner,
  provider: LoginProvider,
  interaction: WhistleInteraction,
): Promise<void> {
  const confirmed = await interaction.prompt({
    type: "confirmation",
    message: `Sign out of ${provider.name}? Local Sessions stop using this account.`,
    confirmLabel: "Sign out",
    cancelLabel: "Keep signed in",
  });
  if (!confirmed) return;
  await owner.logout(provider.id, interaction);
  interaction.notify({
    type: "success",
    message: `Signed out of ${provider.name}.`,
  });
}

/** Cancelling a sign-in is an ordinary ending, not a failure. */
async function unlessCancelled(
  interaction: WhistleInteraction,
  work: () => Promise<void>,
): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (cause) {
    if (interaction.signal.aborted) return false;
    throw cause;
  }
}

/**
 * Provider-agnostic account commands. Every question and status update is a
 * Whistle interaction, so any client that renders interactions renders login.
 */
export function accountCommandDefinitions(
  owner: AccountOwner,
  options: AccountCommandOptions,
): WhistleContribution["commands"] {
  const { policy } = options;
  return [
    {
      id: "account",
      title: "Model accounts",
      category: "Settings",
      projections: {
        help: { order: 10 },
        slash: { aliases: ["account"], order: 10 },
      },
      handler: async (input: WhistleExecutionInput) => {
        const summary = await owner.status(
          input.signal ?? new AbortController().signal,
        );
        input.interaction?.notify({ type: "info", message: summary });
        return summary;
      },
    },
    {
      id: "login",
      title: "Sign in to a model provider",
      category: "Settings",
      projections: {
        help: { order: 11 },
        menu: { order: 11 },
        palette: { order: 11 },
        slash: { aliases: ["login"], order: 11 },
      },
      action: { inputSchema: loginArgumentsSchema },
      handler: async (input: WhistleExecutionInput) => {
        const interaction = requireInteraction(input);
        const request = loginArguments.parse(input.arguments ?? {});
        await unlessCancelled(interaction, async () => {
          const registry = loginRegistry(
            await owner.providers(interaction.signal),
            { policy, host: options.host, scope: options.scope },
          );
          const access =
            request.providerId === undefined
              ? await owner.access(interaction.signal)
              : [];
          const provider = await chooseProvider(
            registry,
            request.providerId,
            interaction,
            "Choose a model provider",
            providerChoices(
              registry,
              access,
              owner.popularProviderIds,
              "login",
            ),
          );
          if (
            request.providerId === undefined &&
            access.some((item) => item.providerId === provider.id)
          ) {
            const action = await interaction.prompt({
              type: "choice",
              message: provider.name,
              options: [
                { value: "switch", label: "Switch account" },
                { value: "logout", label: "Sign out" },
              ],
            });
            if (action === "logout") {
              await signOutProvider(owner, provider, interaction);
              return;
            }
          }
          await signInProvider(owner, provider, interaction, request);
        });
      },
    },
    {
      id: "logout",
      title: "Sign out of a model provider",
      category: "Settings",
      projections: {
        help: { order: 12 },
        palette: { order: 12 },
        slash: { aliases: ["logout"], order: 12 },
      },
      action: { inputSchema: logoutArgumentsSchema },
      handler: async (input: WhistleExecutionInput) => {
        const interaction = requireInteraction(input);
        const request = logoutArguments.parse(input.arguments ?? {});
        await unlessCancelled(interaction, async () => {
          // Only providers the credential owner reports as signed in can be signed out of.
          const signedIn = (await owner.access(interaction.signal))
            .map((access): LoginProvider => ({
              id: access.providerId,
              name: access.providerName,
              methods: [],
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
          if (signedIn.length === 0) {
            interaction.notify({
              type: "info",
              message: await owner.status(interaction.signal),
            });
            return;
          }
          const provider = await chooseProvider(
            signedIn,
            request.providerId,
            interaction,
            "Sign out of which provider?",
            signedIn.map((provider) => ({
              value: provider.id,
              label: provider.name,
            })),
          );
          await signOutProvider(owner, provider, interaction);
        });
      },
    },
  ];
}

/** Contribute the account commands as one lease. */
export function contributeAccountCommands(
  runtime: Pick<WhistleRuntime, "contribute">,
  owner: AccountOwner,
  options: AccountCommandOptions,
): WhistleContributionLease {
  return runtime.contribute({
    sourceId: options.sourceId,
    namespace: options.namespace,
    commands: accountCommandDefinitions(owner, options),
  });
}
