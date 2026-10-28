import { parsePrompt, parsePromptAnswer } from "@fungi.computer/whistle/wire";
import {
  createWhistle,
  type WhistleInteraction,
} from "@fungi.computer/whistle";
import type { ModelPreference } from "@fungi.computer/shiitake/model-preference";
import { expect, it, vi } from "vitest";
import type { ModelAccountContext } from "../src/account-commands.js";
import { createParakeetInteractions } from "../src/commands/interactions.js";

it.each(["save", "read"])(
  "retries a failed model %s without repeating choices or successful work",
  async (failure) => {
    let preference: ModelPreference | null = null;
    let reads = 0;
    const writes: (ModelPreference | null)[] = [];
    const commands = createWhistle();
    const store = createParakeetInteractions();
    const detach = store.attach(commands.present);
    contributeModelCommands(
      commands,
      {
        modelPreference: {
          read: () => {
            reads += 1;
            return failure === "read" && reads === 2
              ? Promise.reject(new Error("The model read failed."))
              : Promise.resolve(preference);
          },
          set: (next) => {
            writes.push(next);
            if (failure === "save" && writes.length === 1)
              return Promise.reject(new Error("The model save failed."));
            preference = next;
            return Promise.resolve();
          },
        },
      },
      {
        account,
        sourceId: "retry-model",
        namespace: "session",
        models: ["Alpha", "Beta"].map((name) => ({
          providerId: "provider",
          providerName: "Provider",
          id: name,
          name,
          reasoning: ["high"],
        })),
        refreshModels: () => Promise.resolve([]),
      },
    );
    const running = commands.execute(
      { namespace: "session", id: "model" },
      { origin: "slash" },
    );
    try {
      for (const answer of ["provider", "1", "high"]) {
        await vi.waitFor(() => {
          expect(store.snapshot().open?.host.snapshot().prompt).toBeDefined();
        });
        const host = store.snapshot().open?.host;
        const prompt = host?.snapshot().prompt;
        if (host === undefined || prompt === undefined)
          throw new Error("The model question is missing.");
        host.answer(prompt.sequence, answer);
      }
      await vi.waitFor(() => {
        expect(store.snapshot().open?.host.snapshot().retryable).toBe(true);
      });
      store.snapshot().open?.host.retry();
      expect((await running).status).toBe("handled");
      const chosen = {
        providerId: "provider",
        modelId: "Beta",
        reasoning: "high",
      };
      expect(writes).toEqual(failure === "save" ? [chosen, chosen] : [chosen]);
      expect(reads).toBe(failure === "save" ? 2 : 3);
      expect(store.snapshot().open).toBeUndefined();
    } finally {
      store.close();
      await running;
      detach();
      commands.close();
    }
  },
);

const account: ModelAccountContext = {
  host: "local",
  scope: "user",
  policy: { loginAllowed: () => true },
  owner: {
    popularProviderIds: [],
    providers: () =>
      Promise.resolve([
        {
          id: "provider",
          name: "Provider",
          methods: [{ kind: "api_key", label: "API key" }],
        },
      ]),
    access: () =>
      Promise.resolve([
        { providerId: "provider", providerName: "Provider", type: "api_key" },
      ]),
    login: () =>
      Promise.reject(new Error("Configured provider should not sign in")),
    logout: () => Promise.reject(new Error("Model picker should not sign out")),
    status: () => Promise.resolve("Provider configured"),
  },
};
import { contributeModelCommands } from "../src/model-commands.js";

it("Enter after a provider choice selects its most recently used model", async () => {
  let preference: ModelPreference | null = null;
  const commands = createWhistle();
  const owner = {
    modelPreference: {
      read: () => Promise.resolve(preference),
      set: (next: ModelPreference | null) => {
        preference = next;
        return Promise.resolve();
      },
    },
  };
  contributeModelCommands(commands, owner, {
    account,
    sourceId: "recent-models",
    namespace: "session",
    models: ["Alpha", "Zeta"].map((name) => ({
      providerId: "provider",
      providerName: "Provider",
      id: name,
      name,
      reasoning: [],
    })),
    refreshModels: () => Promise.resolve([]),
  });
  await commands.execute(
    { namespace: "session", id: "model" },
    {
      origin: "agent",
      arguments: { providerId: "provider", modelId: "Zeta" },
    },
  );
  await commands.execute(
    { namespace: "session", id: "model" },
    { origin: "agent", arguments: null },
  );
  let step = 0;
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal: new AbortController().signal,
    notify: () => undefined,
    prompt: (prompt) => {
      const choice = parsePrompt(prompt);
      if (choice.type !== "choice") throw new Error("Expected a picker");
      step += 1;
      if (step === 1)
        return Promise.resolve(parsePromptAnswer(prompt, "provider"));
      const first = choice.options[0];
      if (first === undefined) throw new Error("Expected a provider model");
      expect(first.label).toBe("Zeta");
      return Promise.resolve(parsePromptAnswer(prompt, first.value));
    },
  };
  expect(
    await commands.execute(
      { namespace: "session", id: "model" },
      { origin: "slash", interaction },
    ),
  ).toMatchObject({ status: "handled" });
  expect(preference).toEqual({ providerId: "provider", modelId: "Zeta" });
});

it("uses one model owner for human and agent selection, inheritance and failures", async () => {
  let preference: ModelPreference | null = null;
  const read = vi.fn(() => Promise.resolve(preference));
  const set = vi.fn((next: ModelPreference | null) => {
    preference = next;
    return Promise.resolve();
  });
  const commands = createWhistle();
  const answers = ["provider", "0", "low"];
  const asked: string[] = [];
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal: new AbortController().signal,
    prompt: (prompt) => {
      asked.push(prompt.message);
      const answer = answers.shift();
      if (answer === undefined)
        throw new Error("Missing scripted prompt answer");
      return Promise.resolve(parsePromptAnswer(prompt, answer));
    },
    notify: () => undefined,
  };
  contributeModelCommands(
    commands,
    { modelPreference: { read, set } },
    {
      account,
      sourceId: "session-owner",
      namespace: "session",
      models: [
        {
          providerId: "provider",
          providerName: "Provider",
          id: "model",
          name: "Model",
          reasoning: ["low"],
        },
      ],
      refreshModels: () =>
        Promise.reject(new Error("Configured provider should not refresh")),
    },
  );
  await expect(
    commands.execute(
      { namespace: "session", id: "model" },
      { origin: "slash", interaction },
    ),
  ).resolves.toMatchObject({ status: "handled" });
  expect(asked).toEqual([
    "Choose a provider",
    "Choose a model",
    "Thinking level for Model",
  ]);
  expect(set).toHaveBeenLastCalledWith({
    providerId: "provider",
    modelId: "model",
    reasoning: "low",
  });
  preference = null;
  set.mockClear();
  await expect(
    commands.execute(
      { namespace: "session", id: "model" },
      { origin: "agent" },
    ),
  ).resolves.toEqual({ status: "handled", result: null });
  const next = { providerId: "provider", modelId: "model", reasoning: "low" };
  await expect(
    commands.execute(
      { namespace: "session", id: "model" },
      { origin: "browser", arguments: next },
    ),
  ).resolves.toEqual({ status: "handled", result: next });
  expect(set).toHaveBeenCalledOnce();
  const invalid = await commands.execute(
    { namespace: "session", id: "model" },
    {
      origin: "agent",
      arguments: { ...next, reasoning: "high" },
    },
  );
  expect(invalid).toMatchObject({
    status: "failed",
    error: { code: "reasoning_unavailable" },
  });
  expect(set).toHaveBeenCalledOnce();
  await expect(
    commands.execute(
      { namespace: "session", id: "model" },
      { origin: "agent", arguments: null },
    ),
  ).resolves.toEqual({ status: "handled", result: null });
  expect(set).toHaveBeenLastCalledWith(null);
  set.mockRejectedValueOnce(new Error("Owner write failed"));
  await expect(
    commands.execute(
      { namespace: "session", id: "model" },
      { origin: "agent", arguments: next },
    ),
  ).resolves.toMatchObject({
    status: "failed",
    error: { message: "Owner write failed" },
  });
  expect(preference).toBeNull();
});

it("publishes model and thinking constraints without choosing a client widget", () => {
  const commands = createWhistle();
  contributeModelCommands(
    commands,
    {
      modelPreference: {
        read: () => Promise.resolve(null),
        set: () => Promise.resolve(),
      },
    },
    {
      account,
      sourceId: "session-owner",
      namespace: "session",
      models: [
        {
          providerId: "provider",
          providerName: "Provider",
          id: "model",
          name: "Model",
          reasoning: [],
        },
      ],
      refreshModels: () =>
        Promise.reject(new Error("Configured provider should not refresh")),
    },
  );
  expect(
    commands.snapshot().palette.map(({ title, category, description }) => ({
      title,
      category,
      description,
    })),
  ).toEqual([
    { title: "Model", category: "Settings", description: "Choose a model" },
    {
      title: "Thinking level",
      category: "Settings",
      description: "Choose thinking effort",
    },
  ]);
  expect(
    commands.snapshot().slash.find((row) => row.alias === "thinking")
      ?.consumesDraft,
  ).toBe(true);
  const action = commands.snapshot().agent[0]?.action;
  expect(action).not.toHaveProperty("presentation");
  expect(action?.inputSchema).toMatchObject({
    anyOf: [
      { type: "null" },
      {
        allOf: [
          expect.any(Object),
          {
            oneOf: [
              {
                properties: {
                  providerId: { const: "provider" },
                  modelId: { const: "model" },
                  reasoning: false,
                },
              },
            ],
          },
        ],
      },
    ],
  });
});

async function interactiveProviderFlow({
  answers,
  configured = [],
  loginFailure,
  refreshFailure,
  signal = new AbortController().signal,
  policy = account.policy,
}: Readonly<{
  answers: readonly string[];
  configured?: readonly import("../src/account-commands.js").ProviderAccess[];
  loginFailure?: Error;
  refreshFailure?: Error;
  signal?: AbortSignal;
  policy?: ModelAccountContext["policy"];
}>) {
  const prompts: import("@fungi.computer/whistle").WhistlePrompt[] = [];
  const remaining = [...answers];
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal,
    prompt: (prompt) => {
      prompts.push(prompt);
      const answer = remaining.shift();
      if (answer === undefined)
        throw new Error(`Unexpected prompt: ${prompt.message}`);
      return Promise.resolve(parsePromptAnswer(prompt, answer));
    },
    notify: () => undefined,
  };
  const login = vi.fn<ModelAccountContext["owner"]["login"]>(
    async (_request, flow) => {
      if (loginFailure) throw loginFailure;
      await flow.prompt({
        type: "text",
        message: "DeepSeek API key",
        secret: true,
      });
    },
  );
  const set = vi.fn(() => Promise.resolve());
  const commands = createWhistle();
  contributeModelCommands(
    commands,
    { modelPreference: { read: () => Promise.resolve(null), set } },
    {
      sourceId: "model-fixture",
      namespace: "session",
      account: {
        ...account,
        policy,
        owner: {
          ...account.owner,
          access: () => Promise.resolve(configured),
          providers: () =>
            Promise.resolve([
              {
                id: "deepseek",
                name: "DeepSeek",
                methods: [{ kind: "api_key", label: "API key" }],
              },
            ]),
          login,
        },
      },
      models: [
        {
          providerId: "deepseek",
          providerName: "DeepSeek",
          id: "chat",
          name: "Chat",
          reasoning: [],
        },
        {
          providerId: "ambient",
          providerName: "Ambient",
          id: "ambient-model",
          name: "Ambient model",
          reasoning: [],
        },
      ],
      refreshModels: () => {
        if (refreshFailure !== undefined) return Promise.reject(refreshFailure);
        return Promise.resolve([
          {
            providerId: "deepseek",
            providerName: "DeepSeek",
            id: "chat",
            name: "Chat",
            reasoning: [],
          },
          {
            providerId: "ambient",
            providerName: "Ambient",
            id: "ambient-model",
            name: "Ambient model",
            reasoning: [],
          },
        ]);
      },
    },
  );
  const result = await commands.execute(
    { namespace: "session", id: "model" },
    {
      origin: "slash",
      interaction,
    },
  );
  commands.close();
  return { prompts, login, set, result };
}

it("signs in an unsigned provider before offering only its models", async () => {
  const flow = await interactiveProviderFlow({
    answers: ["deepseek", "fixture-key", "0"],
  });
  expect(flow.result.status).toBe("handled");
  expect(flow.prompts.map((prompt) => prompt.message)).toEqual([
    "Choose a provider",
    "DeepSeek API key",
    "Choose a model",
  ]);
  expect(flow.prompts[0]).toMatchObject({
    collapsedGroup: "More providers",
    options: [
      { value: "default", label: "Use agent model" },
      { value: "deepseek", group: "More providers" },
    ],
  });
  expect(flow.prompts[2]).toMatchObject({
    options: [{ value: "0", label: "Chat" }],
  });
  expect(flow.login).toHaveBeenCalledOnce();
  expect(flow.set).toHaveBeenCalledWith({
    providerId: "deepseek",
    modelId: "chat",
  });
});

it("keeps a configured ambient provider selectable without inventing a login method", async () => {
  const flow = await interactiveProviderFlow({
    answers: ["ambient", "0"],
    configured: [
      { providerId: "ambient", providerName: "Ambient", type: "api_key" },
    ],
  });
  expect(flow.result.status).toBe("handled");
  expect(flow.prompts[0]).toMatchObject({
    options: [
      { value: "default" },
      { value: "ambient", group: "Signed in" },
      { value: "deepseek", group: "More providers" },
    ],
  });
  expect(flow.login).not.toHaveBeenCalled();
  expect(flow.set).toHaveBeenCalledWith({
    providerId: "ambient",
    modelId: "ambient-model",
  });
});

it("keeps the preference unchanged when provider sign-in fails", async () => {
  const flow = await interactiveProviderFlow({
    answers: ["deepseek"],
    loginFailure: new Error("Provider refused sign-in"),
  });
  expect(flow.result).toMatchObject({
    status: "failed",
    error: { message: "Provider refused sign-in" },
  });
  expect(flow.prompts).toHaveLength(1);
  expect(flow.set).not.toHaveBeenCalled();
});

it("does not save a preference when provider sign-in is cancelled", async () => {
  const controller = new AbortController();
  const cancelled = new Error("Sign-in cancelled");
  controller.abort(cancelled);
  const flow = await interactiveProviderFlow({
    answers: ["deepseek"],
    signal: controller.signal,
    loginFailure: cancelled,
  });
  expect(flow.set).not.toHaveBeenCalled();
  expect(flow.prompts).toHaveLength(1);
  expect(flow.result.status).not.toBe("handled");
});

it("does not treat configured access as permission to offer a forbidden provider", async () => {
  const flow = await interactiveProviderFlow({
    answers: ["default"],
    configured: [
      { providerId: "ambient", providerName: "Ambient", type: "api_key" },
    ],
    policy: { loginAllowed: () => false },
  });
  expect(flow.prompts[0]).toMatchObject({ options: [{ value: "default" }] });
  if (flow.prompts[0]?.type !== "choice")
    throw new Error("Expected provider picker");
  expect(flow.prompts[0].options).toHaveLength(1);
  expect(flow.login).not.toHaveBeenCalled();
  expect(flow.result.status).toBe("handled");
});

it("offers Fungi without a catalog, signs in once and uses the newly authenticated models", async () => {
  const commands = createWhistle();
  const set = vi.fn(() => Promise.resolve());
  let signedIn = false;
  const login = vi.fn(() => {
    signedIn = true;
    return Promise.resolve();
  });
  const refreshModels = vi.fn(() => {
    expect(signedIn).toBe(true);
    return Promise.resolve([
      {
        providerId: "fungi",
        providerName: "Fungi",
        id: "@fungi/luna",
        name: "Luna",
        reasoning: [],
      },
    ]);
  });
  const prompts: import("@fungi.computer/whistle").WhistlePrompt[] = [];
  const answers = ["fungi", "0"];
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal: new AbortController().signal,
    prompt: (prompt) => {
      prompts.push(prompt);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected prompt");
      return Promise.resolve(parsePromptAnswer(prompt, answer));
    },
    notify: () => undefined,
  };
  contributeModelCommands(
    commands,
    { modelPreference: { read: () => Promise.resolve(null), set } },
    {
      account: {
        ...account,
        owner: {
          ...account.owner,
          popularProviderIds: ["fungi", "openai"],
          providers: () =>
            Promise.resolve([
              {
                id: "fungi",
                name: "Fungi",
                methods: [{ kind: "subscription", label: "Sign in to Fungi" }],
              },
            ]),
          access: () =>
            Promise.resolve([
              { providerId: "openai", providerName: "OpenAI", type: "api_key" },
            ]),
          login,
        },
      },
      sourceId: "fungi-fixture",
      namespace: "session",
      models: [
        {
          providerId: "openai",
          providerName: "OpenAI",
          id: "external",
          name: "External",
          reasoning: [],
        },
      ],
      refreshModels,
    },
  );
  try {
    expect(refreshModels).not.toHaveBeenCalled();
    await expect(
      commands.execute(
        { namespace: "session", id: "model" },
        { origin: "slash", interaction },
      ),
    ).resolves.toMatchObject({ status: "handled" });
    expect(prompts[0]).toMatchObject({
      options: [
        { value: "default" },
        { value: "fungi", group: "Default" },
        { value: "openai", group: "Signed in" },
      ],
    });
    expect(prompts[1]).toMatchObject({
      options: [{ value: "0", label: "Luna" }],
    });
    expect(login).toHaveBeenCalledExactlyOnceWith(
      { providerId: "fungi", method: "subscription" },
      interaction,
    );
    expect(refreshModels).toHaveBeenCalledExactlyOnceWith(interaction.signal);
    expect(set).toHaveBeenCalledExactlyOnceWith({
      providerId: "fungi",
      modelId: "@fungi/luna",
    });
  } finally {
    commands.close();
  }
});

it("reports a post-login catalog failure without choosing another provider", async () => {
  const flow = await interactiveProviderFlow({
    answers: ["deepseek", "fixture-key"],
    refreshFailure: new Error("Provider catalog is unreachable"),
  });
  expect(flow.result).toMatchObject({
    status: "failed",
    error: { message: "Provider catalog is unreachable" },
  });
  expect(flow.login).toHaveBeenCalledOnce();
  expect(flow.set).not.toHaveBeenCalled();
});

it("marks the current provider, model and thinking level as current in each picker", async () => {
  let preference: ModelPreference | null = {
    providerId: "provider",
    modelId: "Zeta",
    reasoning: "high",
  };
  const commands = createWhistle();
  const choices: Extract<ReturnType<typeof parsePrompt>, { type: "choice" }>[] =
    [];
  const answers = ["provider", "1", "high"];
  const interaction: WhistleInteraction = {
    run: (operation) => operation(),
    signal: new AbortController().signal,
    prompt: (prompt) => {
      const parsed = parsePrompt(prompt);
      if (parsed.type !== "choice") throw new Error("Expected a picker");
      choices.push(parsed);
      return Promise.resolve(parsePromptAnswer(prompt, answers.shift() ?? ""));
    },
    notify: () => undefined,
  };
  contributeModelCommands(
    commands,
    {
      modelPreference: {
        read: () => Promise.resolve(preference),
        set: (next) => {
          preference = next;
          return Promise.resolve();
        },
      },
    },
    {
      account,
      sourceId: "current-marks",
      namespace: "session",
      models: ["Alpha", "Zeta"].map((name) => ({
        providerId: "provider",
        providerName: "Provider",
        id: name,
        name,
        reasoning: ["low", "high"],
      })),
      refreshModels: () => Promise.resolve([]),
    },
  );
  await commands.execute(
    { namespace: "session", id: "model" },
    { origin: "slash", interaction },
  );
  const [providers, models, thinking] = choices;
  expect(providers).toMatchObject({
    message: "Choose a provider",
    current: "provider",
  });
  expect(models).toMatchObject({ message: "Choose a model", current: "0" });
  expect(models?.options[0]?.label).toBe("Zeta");
  expect(thinking).toMatchObject({ current: "high" });
  expect(JSON.stringify(choices)).not.toContain("(current)");
});
