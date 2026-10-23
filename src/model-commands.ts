import {
  modelPreferenceJsonSchema,
  parseModelPreference,
  type ModelPreference,
} from "@fungi.computer/shiitake/model-preference";
import {
  WhistleActionError,
  type WhistleAvailability,
  type WhistleExecutionInput,
  type WhistleInteraction,
  type WhistleRuntime,
  type WhistleContribution,
} from "@fungi.computer/whistle";
import { z } from "zod";
import {
  loginRegistry,
  signInProvider,
  type LoginProvider,
  type ModelAccountContext,
} from "./account-commands.js";
import { providerChoices } from "./provider-choices.js";

/** A host's maintained catalog projection; no credentials or provider execution. */
export type SessionModelChoice = Readonly<{
  /** Stable provider identity used in a Session preference. */
  providerId: string;
  /** Provider label displayed by clients. */
  providerName: string;
  /** Model identity within this provider. */
  id: string;
  /** Human-facing model label. */
  name: string;
  /** Thinking levels supported by this catalog entry. */
  reasoning: readonly NonNullable<ModelPreference["reasoning"]>[];
}>;

export type ModelPreferenceOwner = Readonly<{
  modelPreference: Readonly<{
    read: () => Promise<ModelPreference | null>;
    set: (preference: ModelPreference | null) => Promise<void>;
  }>;
}>;

/** Contribution identity, catalog and optional local model-picker presentation. */
export type SessionModelCommandOptions = Readonly<{
  /** Shared credential owner and policy for the interactive provider flow. */
  account: ModelAccountContext;
  /** Host source that owns the contribution lease. */
  sourceId: string;
  /** Namespace for the semantic model command. */
  namespace: string;
  /** Catalog used to describe and validate explicit selections. */
  models: readonly SessionModelChoice[];
  /** Read the live catalog after interactive provider sign-in. */
  refreshModels: (
    signal: AbortSignal,
  ) => Promise<readonly SessionModelChoice[]>;
  /** Current semantic availability, checked again before dispatch. */
  availability?: () => WhistleAvailability;
}>;

const defaultChoice = "default";

// Session-local picker memory survives contribution refreshes, not the owner.
const recentModels = new WeakMap<
  ModelPreferenceOwner["modelPreference"]["read"],
  Map<string, ModelPreference>
>();
/** Private memory ceiling, independent of how many models a provider offers. */
const maximumRememberedProviders = 256;

function modelLabel(model: SessionModelChoice) {
  return `${model.providerName} · ${model.name}`;
}

/** Each provider's current or last-used model first, then catalog order. */
function orderModels(
  models: readonly SessionModelChoice[],
  current: ModelPreference | null,
  recent: ReadonlyMap<string, ModelPreference>,
) {
  return [...models].sort((left, right) => {
    const leftPreference =
      current?.providerId === left.providerId
        ? current
        : recent.get(left.providerId);
    const rightPreference =
      current?.providerId === right.providerId
        ? current
        : recent.get(right.providerId);
    const leftCurrent = left.id === leftPreference?.modelId;
    const rightCurrent = right.id === rightPreference?.modelId;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return left.providerName.localeCompare(right.providerName);
  });
}

async function chooseReasoning(
  interaction: WhistleInteraction,
  model: SessionModelChoice,
  current: ModelPreference["reasoning"],
) {
  if (model.reasoning.length === 0) return undefined;
  const answer = await interaction.prompt({
    type: "choice",
    message: `Thinking level for ${model.name}`,
    options: [
      { value: defaultChoice, label: "Model default" },
      ...model.reasoning.map((level) => ({
        value: level,
        label: level === current ? `${level} (current)` : level,
      })),
    ],
  });
  return model.reasoning.find((level) => level === answer);
}

/** Leave one Whistle option for inheriting the Agent model. */
const maximumModelOptions = 255;

async function chooseProviderModels(
  interaction: WhistleInteraction,
  models: readonly SessionModelChoice[],
  account: ModelAccountContext,
  refreshModels: SessionModelCommandOptions["refreshModels"],
) {
  const { owner } = account;
  const [access, registry] = await Promise.all([
    owner.access(interaction.signal),
    owner
      .providers(interaction.signal)
      .then((providers) => loginRegistry(providers, account)),
  ]);
  // The default is discoverable before its authenticated catalog exists.
  const providers: LoginProvider[] = registry.filter(
    (provider) => provider.id === "fungi",
  );
  for (const model of new Map(
    models.map((model) => [model.providerId, model]),
  ).values()) {
    const provider = registry.find(
      (candidate) => candidate.id === model.providerId,
    );
    if (providers.some((candidate) => candidate.id === model.providerId))
      continue;
    if (provider) providers.push(provider);
    else if (
      access.some(
        (candidate) =>
          candidate.providerId === model.providerId &&
          account.policy.loginAllowed({
            providerId: candidate.providerId,
            method: candidate.type === "oauth" ? "subscription" : "api_key",
            host: account.host,
            scope: account.scope,
          }),
      )
    )
      providers.push({
        id: model.providerId,
        name: model.providerName,
        methods: [],
      });
  }
  const providerId = await interaction.prompt({
    type: "choice",
    message: "Model",
    collapsedGroup: "More providers",
    options: [
      { value: defaultChoice, label: "Use agent model" },
      ...providerChoices(
        providers,
        access,
        owner.popularProviderIds,
        "model",
      ).slice(0, maximumModelOptions),
    ],
  });
  if (providerId === defaultChoice) return null;
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider)
    throw new WhistleActionError(
      "provider_unavailable",
      "Choose a listed provider.",
    );
  let catalog = models;
  if (!access.some((candidate) => candidate.providerId === providerId)) {
    await signInProvider(owner, provider, interaction);
    catalog = await interaction.run(() => refreshModels(interaction.signal));
  }
  const selectedModels = catalog
    .filter((model) => model.providerId === providerId)
    .slice(0, maximumModelOptions);
  if (selectedModels.length === 0)
    throw new WhistleActionError(
      "model_unavailable",
      `${provider.name} has no available models. Retry /model.`,
    );
  return selectedModels;
}

/** Describe and invoke the ordinary model-preference owner from any client. */
export function sessionModelCommandDefinitions(
  session: ModelPreferenceOwner,
  options: SessionModelCommandOptions,
): WhistleContribution["commands"] {
  const recent =
    recentModels.get(session.modelPreference.read) ??
    new Map<string, ModelPreference>();
  recentModels.set(session.modelPreference.read, recent);
  const remember = (preference: ModelPreference | null) => {
    if (preference === null) return;
    recent.delete(preference.providerId);
    recent.set(preference.providerId, preference);
    if (recent.size > maximumRememberedProviders) {
      const oldest = recent.keys().next().value;
      if (oldest !== undefined) recent.delete(oldest);
    }
  };
  const preferenceSchema = z
    .record(z.string(), z.json())
    .parse(modelPreferenceJsonSchema);
  const knownChoices = options.models.map((model) => ({
    title: `${model.providerName} · ${model.name}`,
    properties: {
      providerId: { const: model.providerId },
      modelId: { const: model.id },
      reasoning:
        model.reasoning.length === 0 ? false : { enum: [...model.reasoning] },
    },
  }));
  const selectionSchema =
    knownChoices.length === 0
      ? { not: {} }
      : { allOf: [preferenceSchema, { oneOf: knownChoices }] };
  return [
    {
      id: "model",
      title: "Model",
      category: "Settings",
      description: "Choose a model",
      projections: {
        agent: {},
        palette: {},
        help: {},
        slash: { aliases: ["model"], consumesDraft: true },
      },
      action: {
        inputSchema: {
          anyOf: [{ type: "null", title: "Use agent model" }, selectionSchema],
        },
        outputSchema: { anyOf: [{ type: "null" }, preferenceSchema] },
      },
      availability: options.availability ?? (() => ({ status: "available" })),
      handler: async (input: WhistleExecutionInput) => {
        if (input.arguments === undefined) {
          const interaction = input.interaction;
          if (input.origin === "agent" || interaction === undefined)
            return session.modelPreference.read();
          const current = await session.modelPreference.read();
          remember(current);
          const providerModels = await chooseProviderModels(
            interaction,
            options.models,
            options.account,
            options.refreshModels,
          );
          if (providerModels === null) {
            await interaction.run(() => session.modelPreference.set(null));
            return interaction.run(() => session.modelPreference.read());
          }
          const ordered = orderModels(providerModels, current, recent);
          const answer = await interaction.prompt({
            type: "choice",
            message: "Model",
            options: ordered.map((model, index) => ({
              value: String(index),
              label:
                model.providerId === current?.providerId &&
                model.id === current.modelId
                  ? `${modelLabel(model)} (current)`
                  : modelLabel(model),
            })),
          });
          const model = ordered[Number(answer)];
          if (model === undefined)
            throw new WhistleActionError(
              "model_unavailable",
              "Choose a listed model.",
            );
          const previous =
            current?.providerId === model.providerId
              ? current
              : recent.get(model.providerId);
          const reasoning = await chooseReasoning(
            interaction,
            model,
            previous?.reasoning,
          );
          const chosen: ModelPreference =
            reasoning === undefined
              ? { providerId: model.providerId, modelId: model.id }
              : {
                  providerId: model.providerId,
                  modelId: model.id,
                  reasoning,
                };
          await interaction.run(() => session.modelPreference.set(chosen));
          remember(chosen);
          // The mounted owner's effective-model label confirms the choice.
          // A success notice would keep the choice dialog focused until Esc.
          return interaction.run(() => session.modelPreference.read());
        }
        let preference: ModelPreference | null;
        try {
          preference = parseModelPreference(input.arguments);
        } catch {
          throw new WhistleActionError(
            "invalid_model_preference",
            "Model preference arguments are invalid",
          );
        }
        if (preference !== null) {
          const selected = preference;
          const model = options.models.find(
            (choice) =>
              choice.providerId === selected.providerId &&
              choice.id === selected.modelId,
          );
          if (model === undefined)
            throw new WhistleActionError(
              "model_unavailable",
              "That model is not in the current catalog",
            );
          if (
            selected.reasoning !== undefined &&
            !model.reasoning.includes(selected.reasoning)
          )
            throw new WhistleActionError(
              "reasoning_unavailable",
              "That thinking level is not supported by this model",
            );
        }
        await session.modelPreference.set(preference);
        remember(preference);
        return session.modelPreference.read();
      },
    },
    {
      id: "thinking",
      title: "Thinking level",
      category: "Settings",
      description: "Choose thinking effort",
      projections: {
        palette: { order: 1 },
        help: {},
        slash: { aliases: ["thinking"], consumesDraft: true },
      },
      availability: options.availability ?? (() => ({ status: "available" })),
      handler: async (input: WhistleExecutionInput) => {
        const interaction = input.interaction;
        if (interaction === undefined)
          throw new WhistleActionError(
            "interaction_required",
            "Choosing a thinking level needs a person.",
          );
        const current = await session.modelPreference.read();
        const model = options.models.find(
          (choice) =>
            choice.providerId === current?.providerId &&
            choice.id === current.modelId,
        );
        if (current === null || model === undefined)
          throw new WhistleActionError(
            "model_required",
            "Choose a model with /model before its thinking level.",
          );
        if (model.reasoning.length === 0)
          throw new WhistleActionError(
            "reasoning_unavailable",
            `${model.name} has no thinking levels.`,
          );
        const reasoning = await chooseReasoning(
          interaction,
          model,
          current.reasoning,
        );
        const chosen: ModelPreference =
          reasoning === undefined
            ? { providerId: model.providerId, modelId: model.id }
            : { providerId: model.providerId, modelId: model.id, reasoning };
        await interaction.run(() => session.modelPreference.set(chosen));
        return interaction.run(() => session.modelPreference.read());
      },
    },
  ];
}

/** Contribute one model action; owners may update its definitions through the lease. */
export function contributeModelCommands(
  commands: Pick<WhistleRuntime, "contribute">,
  session: ModelPreferenceOwner,
  options: SessionModelCommandOptions,
) {
  return commands.contribute({
    sourceId: options.sourceId,
    namespace: options.namespace,
    commands: sessionModelCommandDefinitions(session, options),
  });
}
