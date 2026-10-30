import { expect, it } from "vitest";
import { composerModelName } from "../src/core/composer-model-name.js";

it("uses the maintained provider label when it knows the execution identity", () => {
  expect(
    composerModelName({
      provider: "cloudflare-workers-ai",
      model: "@cf/moonshotai/kimi-k2.6",
    }),
  ).toBe("Kimi K2.6");
});

it("preserves the actual hosted Kimi K3 identity when Pi has no label for it", () => {
  expect(
    composerModelName({ provider: "openai", model: "moonshotai/kimi-k3" }),
  ).toBe("openai/moonshotai/kimi-k3");
});

it("does not duplicate the provider on an already qualified identity", () => {
  expect(
    composerModelName({
      provider: "openai",
      model: "openai/moonshotai/kimi-k3",
    }),
  ).toBe("openai/moonshotai/kimi-k3");
});
