import { createWhistle } from "@fungi.computer/whistle";
import { expect, it } from "vitest";
import { createParakeetInteractions } from "../src/headless.js";

it("a decision reached through a dialog moves to the composer queue", async () => {
  const whistle = createWhistle();
  const answers: unknown[] = [];
  whistle.contribute({
    sourceId: "test",
    namespace: "probe",
    commands: [
      {
        id: "rows",
        title: "Row actions",
        category: "Probe",
        handler: async ({ interaction }) => {
          if (interaction === undefined) return;
          await interaction.prompt({
            type: "choice",
            message: "Choose a row",
            options: [{ value: "0", label: "Scout · waiting on Shiitake" }],
          });
          answers.push(
            await interaction.prompt({
              type: "decision",
              message: "Which branch?",
              options: [
                { value: "main", label: "main" },
                { value: "dev", label: "dev" },
              ],
            }),
          );
        },
      },
    ],
  });
  const store = createParakeetInteractions();
  store.attach(whistle.present);
  const running = whistle.execute(
    { namespace: "probe", id: "rows" },
    { origin: "menu" },
  );
  await expect
    .poll(() => store.snapshot().open?.host.snapshot().prompt)
    .toBeDefined();
  const dialog = store.snapshot().open?.host;
  const chooser = dialog?.snapshot().prompt;
  if (dialog === undefined || chooser === undefined)
    throw new Error("Expected the row chooser");
  dialog.answer(chooser.sequence, "0");
  await expect.poll(() => store.snapshot().awaiting.items.length).toBe(1);
  // The dialog closed; the composer owns the decision now.
  expect(store.snapshot().open).toBeUndefined();
  const [item] = store.snapshot().awaiting.items;
  const decision = item?.host.snapshot().prompt;
  if (item === undefined || decision === undefined)
    throw new Error("Expected the decision");
  expect(decision.request).toMatchObject({ type: "decision" });
  item.host.answer(decision.sequence, { selected: ["main"] });
  await expect(running).resolves.toMatchObject({ status: "handled" });
  expect(answers).toEqual([{ selected: ["main"] }]);
  expect(store.snapshot().awaiting.items).toEqual([]);
});

it("keeps one draft per record revision for the session and forgets superseded ones", () => {
  const store = createParakeetInteractions();
  const first = store.drafts.claim('["approval","r",1]');
  expect(store.drafts.claim('["approval","r",1]')).toBe(first);
  store.drafts.supersede('["approval","r",', '["approval","r",2]');
  expect(store.drafts.claim('["approval","r",1]')).not.toBe(first);
  const kept = store.drafts.claim('["approval","r",2]');
  store.drafts.release('["approval","r",2]');
  expect(store.drafts.claim('["approval","r",2]')).not.toBe(kept);
});
