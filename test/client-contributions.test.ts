import {
  defineClientEntry,
  type ClientContributionV1,
} from "@fungi.computer/shiitake/client-entry";
import { ExtensionId } from "@fungi.computer/shiitake/extensions";
import type { SessionExtensionSlots } from "@fungi.computer/shiitake/client";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { createClientContributions } from "../src/core/client-contributions.js";

const contract = {
  id: ExtensionId.make("probe"),
  commands: {},
  projection: { schema: Schema.Struct({ title: Schema.String }) },
};
const empty: ClientContributionV1 = {
  chips: [],
  panel: [],
  timeline: { cells: [], omitted: 0 },
  waiting: null,
};

it("evaluates once per observed slot, retires invalid output, and leaves other entries usable", () => {
  let calls = 0;
  const failure = new Error("Probe producer failed");
  const errors: unknown[] = [];
  const entry = defineClientEntry(contract, {
    contribute: (view) => {
      calls += 1;
      if (view.status !== "running" || view.value === null) return empty;
      if (view.value.title === "broken") throw failure;
      return { ...empty, panel: [{ id: "state", title: view.value.title }] };
    },
  });
  const other = defineClientEntry(
    { ...contract, id: ExtensionId.make("other") },
    {
      contribute: () => ({
        ...empty,
        panel: [{ id: "state", title: "Other entry" }],
      }),
    },
  );
  const owner = createClientContributions([entry, other], (id, error) => {
    errors.push([id, error]);
  });
  const slots: SessionExtensionSlots = {
    probe: {
      status: "running",
      revision: "sha256:fixture",
      value: { title: "Current" },
    },
  };
  owner.update(slots);
  owner.update(slots);
  expect(calls).toBe(1);
  expect(owner.snapshot().map(({ entryId }) => entryId)).toEqual([
    "probe",
    "other",
  ]);
  const changed: SessionExtensionSlots = {
    probe: {
      status: "running",
      revision: "sha256:fixture",
      value: { title: "broken" },
    },
  };
  owner.update(changed);
  owner.update(changed);
  owner.update({
    probe: {
      status: "running",
      revision: "sha256:fixture",
      value: { title: "broken" },
    },
  });
  expect(errors).toEqual([["probe", failure]]);
  expect(owner.snapshot().map(({ entryId }) => entryId)).toEqual(["other"]);
  owner.dispose();
  owner.update(slots);
  expect(calls).toBe(3);
  expect(owner.snapshot()).toEqual([]);
});

it("admits only commands in the contribution's own running advertised catalog", () => {
  const entry = defineClientEntry(contract, {
    contribute: () => ({
      ...empty,
      panel: [
        {
          id: "control",
          title: "Control",
          actions: [{ id: "change", label: "Change" }],
        },
      ],
    }),
  });
  const errors: Error[] = [];
  const owner = createClientContributions([entry], (_id, error) => {
    errors.push(error);
  });
  const slot = {
    status: "running",
    revision: "sha256:fixture",
    value: { title: "Current" },
  } satisfies SessionExtensionSlots[string];
  owner.update({ probe: slot });
  expect(owner.snapshot()).toEqual([]);
  expect(errors[0]?.message).toContain("running advertised catalog");
  owner.update({
    probe: {
      ...slot,
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [
          { id: "elsewhere", title: "Other command", category: "Probe" },
        ],
      },
    },
  });
  expect(owner.snapshot()).toEqual([]);
  expect(errors[1]?.message).toContain("not advertised");
  owner.update({
    probe: {
      ...slot,
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [{ id: "change", title: "Change", category: "Probe" }],
      },
    },
  });
  expect(owner.snapshot()[0]?.value.panel[0]?.actions?.[0]?.id).toBe("change");
  owner.dispose();
});

it("reports the original producer error and recovers", () => {
  const cause = new Error("Producer state is invalid");
  const errors: Error[] = [];
  const entry = defineClientEntry(contract, {
    contribute: (view) => {
      if (view.status === "running" && view.value?.title === "broken")
        throw cause;
      return { ...empty, panel: [{ id: "state", title: "Recovered" }] };
    },
  });
  const owner = createClientContributions([entry], (_id, error) => {
    errors.push(error);
  });
  try {
    owner.update({
      probe: {
        status: "running",
        revision: "sha256:broken",
        value: { title: "broken" },
      },
    });
    expect(owner.snapshot()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(cause);
    owner.update({
      probe: {
        status: "running",
        revision: "sha256:recovered",
        value: { title: "ready" },
      },
    });
    expect(owner.snapshot()[0]?.value.panel[0]?.title).toBe("Recovered");
  } finally {
    owner.dispose();
  }
});
it("admits inspections only for the entry's advertised command", () => {
  const errors: string[] = [];
  const entry = defineClientEntry(contract, {
    contribute: () => ({
      ...empty,
      panel: [
        {
          id: "summary",
          title: "Current",
          inspection: {
            commandId: "inspect",
            title: "Inspect",
            rows: [{ id: "step", title: "Step" }],
          },
        },
      ],
    }),
  });
  const owner = createClientContributions([entry], (_id, error) =>
    errors.push(error.message),
  );
  const slot = {
    status: "running",
    revision: "sha256:fixture",
    value: { title: "Current" },
  } as const;
  owner.update({
    probe: {
      ...slot,
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [{ id: "other", title: "Other", category: "Conversation" }],
      },
    },
  });
  expect(owner.snapshot()).toEqual([]);
  expect(errors).toEqual([
    "Client inspection inspect is not advertised by its entry",
  ]);
  owner.update({
    probe: {
      ...slot,
      catalog: {
        protocol: "whistle.catalog/v1",
        commands: [
          { id: "inspect", title: "Inspect", category: "Conversation" },
        ],
      },
    },
  });
  expect(owner.snapshot()[0]?.value.panel[0]?.inspection?.commandId).toBe(
    "inspect",
  );
});
