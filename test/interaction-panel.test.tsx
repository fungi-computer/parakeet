// @vitest-environment jsdom
import { createWhistle } from "@fungi.computer/whistle";
import {
  createWhistleInteractionHost,
  type WhistleInteractionHost,
} from "@fungi.computer/whistle/interaction";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";

import { contributeAccountCommands } from "../src/account-commands.js";
import { InteractionPanel } from "../src/components/InteractionPanel.js";
import {
  fixtureAccountOwner,
  fixturePolicy,
} from "./fixtures/account-owner.js";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const roots = new Set<Root>();
afterEach(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
  document.body.replaceChildren();
});

/** Mount the browser presenter the same way the terminal mounts its dialog. */
function mountLogin() {
  const whistle = createWhistle();
  const fixture = fixtureAccountOwner();
  contributeAccountCommands(whistle, fixture.owner, {
    sourceId: "browser",
    namespace: "account",
    host: "local",
    scope: "user",
    policy: fixturePolicy,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  let host: WhistleInteractionHost | undefined;
  whistle.present(({ title }) => {
    host = createWhistleInteractionHost({ title });
    const opened = host;
    act(() => {
      root.render(<InteractionPanel host={opened} />);
    });
    return opened.begin();
  });
  return { whistle, fixture, container };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function option(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent.includes(label),
  );
  if (!(found instanceof HTMLElement)) throw new Error(`No option ${label}`);
  return found;
}

it("renders the login definition's choices and device handoff", async () => {
  const { whistle, fixture, container } = mountLogin();
  const run = whistle.execute("account:login", { origin: "browser" });
  await settle();
  expect(container.querySelector("h2")?.textContent).toBe(
    "Sign in to a model provider",
  );
  const labels = [...container.querySelectorAll('[role="option"]')].map(
    (node) => node.textContent,
  );
  expect(labels).toEqual([
    "OpenAIAPI key or Subscription",
    "AnthropicAPI key",
    "OpenRouterAPI key",
  ]);
  act(() => {
    option(container, "OpenAI").click();
  });
  await settle();
  act(() => {
    option(container, "Sign in with ChatGPT").click();
  });
  await settle();
  expect(container.textContent).toContain("WDJB-MJHT");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "https://auth.example.test/device",
  );
  fixture.approve();
  await expect(run).resolves.toEqual({ status: "handled" });
  await settle();
  expect(container.textContent).toContain("Signed in to OpenAI.");
});

it("collects a secret without echoing it", async () => {
  const { whistle, container } = mountLogin();
  const run = whistle.execute("account:login", {
    origin: "browser",
    arguments: { providerId: "openai", method: "api_key" },
  });
  await settle();
  const input = container.querySelector("input");
  expect(input?.type).toBe("password");
  expect(container.textContent).toContain("Paste your API key");
  await expect(Promise.race([run, Promise.resolve("pending")])).resolves.toBe(
    "pending",
  );
});

it("submits blank text to skip optional context", async () => {
  const host = createWhistleInteractionHost({ title: "Answer a question" });
  const session = host.begin();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  const answer = session.interaction.prompt({
    type: "text",
    message: "Additional context (leave blank to skip):",
  });
  act(() => {
    root.render(<InteractionPanel host={host} />);
  });
  const submit = container.querySelector('button[type="submit"]');
  if (!(submit instanceof HTMLButtonElement))
    throw new Error("Missing Continue button");
  expect(submit.disabled).toBe(false);
  act(() => {
    submit.click();
  });
  await expect(answer).resolves.toBe("");
  act(() => {
    host.cancel();
  });
});
