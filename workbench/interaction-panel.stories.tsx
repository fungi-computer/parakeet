import type { Story, StoryDefault } from "@ladle/react";
import { createWhistle } from "@fungi.computer/whistle";
import {
  createWhistleInteractionHost,
  type WhistleInteractionHost,
} from "@fungi.computer/whistle/interaction";
import { useEffect, useState } from "react";

import { contributeAccountCommands } from "../src/account-commands.js";
import { InteractionPanel } from "../src/components/InteractionPanel.js";
import {
  fixtureAccountOwner,
  fixturePolicy,
} from "../test/fixtures/account-owner.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Interaction panel" } satisfies StoryDefault;

type Step = (host: WhistleInteractionHost) => void;

/** Run the real login contribution, answering the first prompts in order. */
function LoginStory({
  steps,
  fail,
}: Readonly<{ steps: readonly Step[]; fail?: boolean }>) {
  const [host, setHost] = useState<WhistleInteractionHost>();
  useEffect(() => {
    const whistle = createWhistle();
    const fixture = fixtureAccountOwner();
    const owner =
      fail === true
        ? {
            ...fixture.owner,
            login: () =>
              Promise.reject(new Error("The provider refused this key.")),
          }
        : fixture.owner;
    contributeAccountCommands(whistle, owner, {
      sourceId: "workbench",
      namespace: "account",
      host: "local",
      scope: "user",
      policy: fixturePolicy,
    });
    const remaining = [...steps];
    whistle.present(({ title }) => {
      const created = createWhistleInteractionHost({ title });
      created.subscribe(() => {
        if (created.snapshot().prompt === undefined) return;
        const next = remaining.shift();
        if (next !== undefined)
          queueMicrotask(() => {
            next(created);
          });
      });
      setHost(created);
      return created.begin();
    });
    void whistle.execute("account:login", { origin: "browser" });
    return () => {
      whistle.close();
    };
  }, [steps, fail]);
  return (
    <div className="max-w-[28rem] p-md">
      {host === undefined ? null : <InteractionPanel host={host} />}
    </div>
  );
}

const choose =
  (value: string): Step =>
  (host) => {
    const pending = host.snapshot().prompt;
    if (pending !== undefined) host.answer(pending.sequence, value);
  };

const noSteps: readonly Step[] = [];
const subscriptionSteps = [choose("openai"), choose("subscription")];
const keySteps = [choose("openai"), choose("api_key")];
const failureSteps = [
  choose("openai"),
  choose("api_key"),
  choose("sk-fixture"),
];

export const ProviderChoice: Story = () => <LoginStory steps={noSteps} />;
export const DeviceCode: Story = () => <LoginStory steps={subscriptionSteps} />;
export const ApiKey: Story = () => <LoginStory steps={keySteps} />;
export const Failure: Story = () => <LoginStory steps={failureSteps} fail />;
