import { createWhistle, type WhistlePrompt } from "@fungi.computer/whistle";
import {
  createWhistleInteractionHost,
  type WhistleInteractionHost,
} from "@fungi.computer/whistle/interaction";
import { describe, expect, it, vi } from "vitest";
import { createParakeetInteractions } from "../src/headless.js";
import {
  contributeAccountCommands,
  loginRegistry,
  type AccountOwner,
  type LoginPolicy,
  type LoginProvider,
} from "../src/account-commands.js";

const providers: readonly LoginProvider[] = [
  {
    id: "zeta",
    name: "Zeta",
    methods: [{ kind: "api_key", label: "Zeta API key" }],
  },
  {
    id: "alpha",
    name: "Alpha",
    methods: [
      { kind: "api_key", label: "Alpha API key" },
      { kind: "subscription", label: "Alpha Pro" },
    ],
  },
  {
    id: "beta",
    name: "Beta",
    methods: [{ kind: "subscription", label: "Beta Max" }],
  },
];

/** Stand-in for the credential policy module: Beta subscriptions are withheld. */
const policy: LoginPolicy = {
  loginAllowed: ({ providerId, method, host }) =>
    method === "api_key" || (host === "local" && providerId !== "beta"),
};

describe("login registry", () => {
  it("offers only what the policy allows, sorted by name", () => {
    expect(
      loginRegistry(providers, { policy, host: "local", scope: "user" }),
    ).toEqual([providers[1], providers[0]]);
    expect(
      loginRegistry(providers, { policy, host: "hosted", scope: "user" }).map(
        (provider) => [
          provider.id,
          provider.methods.map((method) => method.kind),
        ],
      ),
    ).toEqual([
      ["alpha", ["api_key"]],
      ["zeta", ["api_key"]],
    ]);
  });
});

/** Answer each prompt in order, recording what the human was shown. */
function scriptedPresenter(
  answers: (prompt: WhistlePrompt) => string | boolean,
) {
  const shown: WhistlePrompt[] = [];
  const hosts: WhistleInteractionHost[] = [];
  const presenter = ({ title }: { title: string }) => {
    const host = createWhistleInteractionHost({ title });
    hosts.push(host);
    host.subscribe(() => {
      const pending = host.snapshot().prompt;
      if (pending === undefined) return;
      shown.push(pending.request);
      queueMicrotask(() => {
        host.answer(pending.sequence, answers(pending.request));
      });
    });
    return host.begin();
  };
  return { presenter, shown, hosts };
}

function owner(overrides: Partial<AccountOwner> = {}) {
  return {
    popularProviderIds: [],
    access: vi.fn<AccountOwner["access"]>(() => Promise.resolve([])),
    providers: vi.fn(() => Promise.resolve(providers)),
    login: vi.fn<AccountOwner["login"]>(() => Promise.resolve()),
    logout: vi.fn<AccountOwner["logout"]>(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve("Alpha: api_key")),
    ...overrides,
  };
}

describe("account commands", () => {
  it("asks provider then method, and hands the choice to the owner", async () => {
    const whistle = createWhistle();
    const account = owner();
    contributeAccountCommands(whistle, account, {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    const { presenter, shown, hosts } = scriptedPresenter((prompt) =>
      prompt.type === "choice"
        ? prompt.message.startsWith("Sign in")
          ? "alpha"
          : "subscription"
        : true,
    );
    whistle.present(presenter);
    await expect(
      whistle.execute(
        { namespace: "account", id: "login" },
        { origin: "slash" },
      ),
    ).resolves.toEqual({ status: "handled" });
    expect(
      shown.map(
        (prompt) =>
          prompt.type === "choice" &&
          prompt.options.map((option) => option.value),
      ),
    ).toEqual([
      ["alpha", "zeta"],
      ["api_key", "subscription"],
    ]);
    expect(account.login).toHaveBeenCalledWith(
      { providerId: "alpha", method: "subscription" },
      expect.anything(),
    );
    expect(hosts[0]?.snapshot().status).toBe("done");
    expect(hosts[0]?.snapshot().message?.type).not.toBe("success");
  });

  it("refuses a provider or method the policy withholds", async () => {
    const whistle = createWhistle();
    contributeAccountCommands(whistle, owner(), {
      sourceId: "test",
      namespace: "account",
      host: "hosted",
      scope: "user",
      policy,
    });
    whistle.present(scriptedPresenter(() => "unused").presenter);
    await expect(
      whistle.execute(
        { namespace: "account", id: "login" },
        {
          origin: "browser",
          arguments: { providerId: "beta" },
        },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "unknown_provider" },
    });
    await expect(
      whistle.execute(
        { namespace: "account", id: "login" },
        {
          origin: "browser",
          arguments: { providerId: "alpha", method: "subscription" },
        },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "method_unavailable" },
    });
  });

  it("needs a human and treats cancellation as an ordinary ending", async () => {
    const whistle = createWhistle();
    const account = owner();
    contributeAccountCommands(whistle, account, {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    await expect(
      whistle.execute(
        { namespace: "account", id: "login" },
        { origin: "agent" },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      error: { code: "interaction_required" },
    });
    const host = createWhistleInteractionHost({ title: "Sign in" });
    whistle.present(() => {
      const session = host.begin();
      queueMicrotask(() => {
        host.cancel();
      });
      return session;
    });
    await expect(
      whistle.execute(
        { namespace: "account", id: "login" },
        { origin: "slash" },
      ),
    ).resolves.toEqual({ status: "handled" });
    expect(account.login).not.toHaveBeenCalled();
  });

  it("Esc during sign-in shows nothing: no error, no echo of the cancel", async () => {
    const whistle = createWhistle();
    const account = owner({
      login: vi.fn<AccountOwner["login"]>(
        (_request, interaction) =>
          new Promise<void>((_resolve, reject) => {
            interaction.signal.addEventListener(
              "abort",
              () => {
                reject(new Error("Authentication cancelled"));
              },
              { once: true },
            );
          }),
      ),
    });
    contributeAccountCommands(whistle, account, {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    const store = createParakeetInteractions();
    const toasts: unknown[] = [];
    store.subscribeToasts((toast) => toasts.push(toast));
    store.attach(whistle.present);
    const running = whistle.execute(
      { namespace: "account", id: "login" },
      {
        origin: "slash",
        arguments: { providerId: "zeta", method: "api_key" },
      },
    );
    await expect.poll(() => store.snapshot().open).toBeDefined();
    store.close();
    await expect(running).resolves.toEqual({ status: "handled" });
    expect(store.snapshot().notice).toBeUndefined();
    expect(toasts).toEqual([]);
  });

  it("does not keep an info line posted before Esc as a notice", async () => {
    const whistle = createWhistle();
    whistle.contribute({
      sourceId: "test",
      namespace: "probe",
      commands: [
        {
          id: "wait",
          title: "Wait",
          category: "Probe",
          projections: { slash: { aliases: ["wait"] } },
          handler: async (input) => {
            const interaction = input.interaction;
            if (interaction === undefined) return;
            interaction.notify({ type: "progress", message: "Working" });
            interaction.notify({ type: "info", message: "Heads up" });
            await new Promise<void>((resolve) => {
              interaction.signal.addEventListener("abort", () => {
                resolve();
              });
            });
          },
        },
      ],
    });
    const store = createParakeetInteractions();
    store.attach(whistle.present);
    const running = whistle.execute(
      { namespace: "probe", id: "wait" },
      { origin: "slash" },
    );
    await expect.poll(() => store.snapshot().open).toBeDefined();
    store.close();
    await running;
    expect(store.snapshot()).toMatchObject({
      notice: undefined,
      open: undefined,
    });
  });

  // Locks in how the dialog treats a failed sign-in; it passed before the fix
  // too. The fail-first proof is apps/tui/test/login-blank-key.test.tsx.
  it("shows a refused blank API key as plain No key entered, never as signed in", async () => {
    const whistle = createWhistle();
    const account = owner({
      login: vi.fn<AccountOwner["login"]>(() =>
        Promise.reject(new Error("No key entered")),
      ),
    });
    contributeAccountCommands(whistle, account, {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    const { presenter, hosts } = scriptedPresenter(() => "zeta");
    whistle.present(presenter);
    const outcome = whistle.execute(
      { namespace: "account", id: "login" },
      {
        origin: "slash",
        arguments: { providerId: "zeta" },
      },
    );
    try {
      await vi.waitFor(() => {
        expect(hosts[0]?.snapshot()).toMatchObject({
          status: "failed",
          failure: "No key entered",
          retryable: true,
        });
      });
      expect(hosts[0]?.snapshot().message?.type).not.toBe("success");
    } finally {
      hosts[0]?.cancel();
      await outcome;
      whistle.close();
    }
  });

  it("confirms before signing out", async () => {
    const whistle = createWhistle();
    const account = owner({
      access: () =>
        Promise.resolve([
          { providerId: "zeta", providerName: "Zeta", type: "api_key" },
        ]),
    });
    contributeAccountCommands(whistle, account, {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    let confirm = false;
    whistle.present(
      scriptedPresenter((prompt) =>
        prompt.type === "confirmation" ? confirm : "zeta",
      ).presenter,
    );
    await whistle.execute(
      { namespace: "account", id: "logout" },
      { origin: "slash" },
    );
    expect(account.logout).not.toHaveBeenCalled();
    confirm = true;
    await whistle.execute(
      { namespace: "account", id: "logout" },
      { origin: "slash" },
    );
    expect(account.logout).toHaveBeenCalledWith("zeta", expect.anything());
  });

  it("reports status to agents and humans alike", async () => {
    const whistle = createWhistle();
    contributeAccountCommands(whistle, owner(), {
      sourceId: "test",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    await expect(
      whistle.execute(
        { namespace: "account", id: "account" },
        { origin: "agent" },
      ),
    ).resolves.toEqual({ status: "handled", result: "Alpha: api_key" });
  });
});

it.each(["switch", "logout"])(
  "a signed-in provider offers %s through the existing account owner",
  async (action) => {
    const account = owner({
      popularProviderIds: ["alpha"],
      access: () =>
        Promise.resolve([
          { providerId: "alpha", providerName: "Alpha", type: "oauth" },
        ]),
    });
    const commands = createWhistle();
    contributeAccountCommands(commands, account, {
      sourceId: "signed-in",
      namespace: "account",
      host: "local",
      scope: "user",
      policy,
    });
    const flow = scriptedPresenter((prompt) => {
      if (prompt.type === "confirmation") return true;
      if (prompt.message === "Sign in to a model provider") return "alpha";
      if (prompt.message === "Already signed in to Alpha") return action;
      return "subscription";
    });
    commands.present(flow.presenter);
    await expect(
      commands.execute(
        { namespace: "account", id: "login" },
        { origin: "slash" },
      ),
    ).resolves.toMatchObject({ status: "handled" });
    expect(flow.shown[0]).toMatchObject({
      collapsedGroup: "More providers",
      options: [
        { value: "alpha", group: "Signed in" },
        { value: "zeta", group: "More providers" },
      ],
    });
    expect(flow.shown[1]).toMatchObject({
      options: [
        { value: "switch", label: "Switch account" },
        { value: "logout", label: "Sign out…", destructive: true },
      ],
    });
    if (action === "switch") {
      expect(account.login).toHaveBeenCalledWith(
        { providerId: "alpha", method: "subscription" },
        expect.anything(),
      );
      expect(account.logout).not.toHaveBeenCalled();
    } else {
      expect(flow.shown[2]).toMatchObject({
        type: "confirmation",
        confirmLabel: "Sign out",
        destructive: true,
      });
      expect(account.logout).toHaveBeenCalledWith("alpha", expect.anything());
      expect(account.login).not.toHaveBeenCalled();
    }
    commands.close();
  },
);
