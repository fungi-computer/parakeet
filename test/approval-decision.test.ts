import type {
  WhistleDecisionAnswer,
  WhistlePrompt,
} from "@fungi.computer/whistle";
import { createWhistleInteractionHost } from "@fungi.computer/whistle/interaction";
import { expect, it, vi } from "vitest";

import {
  approvalCardCopy,
  approvalRefusal,
  askApproval,
  type ApprovalAnswerInput,
  type ApprovalFacts,
  type ApprovalSource,
} from "../src/core/approval-decision.js";

const view: ApprovalFacts = {
  record: {
    recordId: "record-1",
    revision: 7,
    requester: {
      displayName: "Research Agent",
      agentId: "agent-1",
      sessionId: "session-1",
      principalId: "principal-1",
    },
    module: "linear",
    operation: "create_issue",
    access: "external",
    description: {
      app: { displayName: "Notes", operationLabel: "Save a note" },
      inputBytes: 10,
      inputSha256: "0123456789abcdef".repeat(4),
    },
    reversibility: "irreversible-external",
    expiresAt: 10_000,
  },
  canAnswer: true,
};

/** An interaction whose person gives the scripted answers, in order. */
function person(answers: WhistleDecisionAnswer[]) {
  const asked: WhistlePrompt[] = [];
  const host = createWhistleInteractionHost({ title: "Approval" });
  const session = host.begin();
  host.subscribe(() => {
    const pending = host.snapshot().prompt;
    if (pending === undefined) return;
    asked.push(pending.request);
    const next = answers.shift();
    if (next === undefined) throw new Error("Unexpected prompt");
    queueMicrotask(() => host.answer(pending.sequence, next));
  });
  return { interaction: session.interaction, asked };
}

function source(
  overrides: Partial<ApprovalSource> = {},
): ApprovalSource & { sent: ApprovalAnswerInput[] } {
  const sent: ApprovalAnswerInput[] = [];
  return {
    snapshot: () => view,
    subscribe: () => () => undefined,
    answer: (input) => {
      sent.push(input);
      return Promise.resolve({ kind: "answered" });
    },
    ...overrides,
    sent,
  };
}

const options = {
  home: "/home/me",
  width: 80,
  now: 0,
  noteLimit: 512,
  stillCurrent: () => true,
  onFailure: () => undefined,
};

it("a connected tool is asked as Approve once, Deny and a Deny-and-say-why line", async () => {
  const { interaction, asked } = person([{ selected: ["approve"] }]);
  const owner = source();
  expect(
    await askApproval(interaction, { ...options, view, source: owner }),
  ).toEqual({
    kind: "answered",
  });
  expect(asked[0]).toMatchObject({
    type: "decision",
    message: "Allow Notes to save a note?",
    options: [
      { value: "approve", label: "Approve once" },
      { value: "deny", label: "Deny" },
    ],
    other: { label: "Deny and say why…", blank: "deny" },
  });
  expect(owner.sent).toEqual([
    { recordId: "record-1", decision: "approve", expectedRevision: 7 },
  ]);
});

it("says in plain words what the Agent wants, not that it uses a connected tool", () => {
  const write = {
    ...view,
    record: { ...view.record, access: "write" as const },
  };
  expect(approvalCardCopy(write, undefined, options).content.summary).toBe(
    "Research Agent wants to make a change in Notes. The Agent continues after you answer.",
  );
  expect(approvalCardCopy(view, undefined, options).content.summary).toBe(
    "Research Agent wants to act outside Fungi through Notes. The Agent continues after you answer.",
  );
  const unlabelled = {
    ...view,
    record: {
      ...view.record,
      description: { inputBytes: 10, inputSha256: "a".repeat(64) },
    },
  };
  expect(approvalCardCopy(unlabelled, undefined, options).content.summary).toBe(
    "Research Agent wants to use a connected tool. The Agent continues after you answer.",
  );
});

it("asks for an App method whose catalog label would not fit a sixty-character title", async () => {
  // Tourtois' real layout.place label: "Allow Tourtois to place an available
  // widget with compare-and-set?" is 65 characters, which a prompt refuses.
  const long = {
    ...view,
    record: {
      ...view.record,
      module: "attachment_4d3nadxmrztsaekqm3do2",
      operation: "layout.place",
      access: "write" as const,
      reversibility: "reversible" as const,
      description: {
        app: {
          displayName: "Tourtois",
          operationLabel: "Place an available widget with compare-and-set.",
        },
        inputBytes: 10,
        inputSha256: "0123456789abcdef".repeat(4),
      },
    },
  };
  const card = approvalCardCopy(long, undefined, options);
  expect(card.content.title.length).toBeLessThanOrEqual(60);
  expect(card.content.title).toContain("Tourtois");
  // The whole action is still on the card, as a fact the person can read.
  expect(card.content.facts).toContainEqual({
    label: "Action",
    value: "Place an available widget with compare-and-set.",
  });
  const { interaction, asked } = person([{ selected: ["approve"] }]);
  expect(
    await askApproval(interaction, {
      ...options,
      view: long,
      source: source(),
    }),
  ).toEqual({ kind: "answered" });
  expect(asked).toHaveLength(1);
});

it("keeps the title within sixty characters for a long App name or identifier", () => {
  const named = {
    ...view,
    record: {
      ...view.record,
      description: {
        app: {
          displayName: "A".repeat(80),
          operationLabel: "Save a note",
        },
        inputBytes: 10,
        inputSha256: "0123456789abcdef".repeat(4),
      },
    },
  };
  expect(
    approvalCardCopy(named, undefined, options).content.title.length,
  ).toBeLessThanOrEqual(60);
  const unlabelled = {
    ...view,
    record: {
      ...view.record,
      module: "m".repeat(70),
      description: { inputBytes: 10, inputSha256: "a".repeat(64) },
    },
  };
  expect(
    approvalCardCopy(unlabelled, undefined, options).content.title.length,
  ).toBeLessThanOrEqual(60);
});

it("a prompt that cannot be shown denies the request, tells the person once, and names why", async () => {
  const { interaction } = person([]);
  const refusing = {
    ...interaction,
    prompt: () => Promise.reject(new Error("title too long")),
  };
  const owner = source();
  const shown: unknown[] = [];
  const outcome = await askApproval(refusing, {
    ...options,
    view,
    source: owner,
    onUnshowable: (message) => {
      shown.push(message);
    },
  });
  expect(outcome).toMatchObject({ kind: "refused" });
  // The Agent's call ends now with a named reason, not at its deadline.
  expect(owner.sent).toHaveLength(1);
  expect(owner.sent[0]).toMatchObject({
    recordId: "record-1",
    decision: "deny",
    expectedRevision: 7,
  });
  expect(owner.sent[0]?.denialNote).toContain("could not be shown");
  expect(shown).toHaveLength(1);
  expect(shown[0]).toContain("Nothing ran");
  expect(shown[0]).toContain("Couldn't show this request, so it was denied");
});

const LONG = "x".repeat(70);

it("a family label over sixty characters still shows its confirmation and never denies", async () => {
  const enable = vi.fn(() => Promise.resolve(true));
  const owner = source({
    family: { label: `Always allow ${LONG} to make changes`, enable },
  });
  const { interaction, asked } = person([
    { selected: ["family"] },
    { selected: ["family"] },
    { selected: ["approve"] },
  ]);
  expect(
    await askApproval(interaction, { ...options, view, source: owner }),
  ).toEqual({ kind: "answered" });
  expect(enable).toHaveBeenCalledOnce();
  for (const prompt of asked)
    expect(
      prompt.type === "decision" ? prompt.message.length : 0,
    ).toBeLessThanOrEqual(60);
  expect(owner.sent.map(({ decision }) => decision)).toEqual(["approve"]);
});

it("an Always prefix over sixty characters still shows its confirmation and never denies", async () => {
  const review = {
    form: "direct" as const,
    kind: "exec" as const,
    command: "git add hello.js",
    cwd: "/home/me/garden",
    justification: "Stage changes",
    prefix: ["git", LONG],
  };
  const { interaction, asked } = person([
    { selected: ["always"] },
    { selected: ["always-allow"] },
  ]);
  const owner = source({ review });
  await askApproval(interaction, { ...options, view, source: owner });
  expect(asked).toHaveLength(2);
  for (const prompt of asked)
    expect(
      prompt.type === "decision" ? prompt.message.length : 0,
    ).toBeLessThanOrEqual(60);
  // A standing rule shows exactly what it allows, even when the title cannot.
  const confirmation = asked[1];
  expect(
    confirmation?.type === "decision" ? confirmation.facts : undefined,
  ).toContainEqual({ label: "Command prefix", value: `git ${LONG}` });
  expect(owner.sent.map(({ decision }) => decision)).toEqual(["always-allow"]);
});

it("an escape command over sixty characters still shows its card and never denies", async () => {
  const review = {
    form: "direct" as const,
    kind: "exec" as const,
    command: `git commit -m ${LONG}`,
    cwd: "/home/me/garden",
    justification: "Stage changes",
  };
  const { interaction, asked } = person([{ selected: ["approve"] }]);
  const owner = source({ review });
  await askApproval(interaction, { ...options, view, source: owner });
  expect(asked).toHaveLength(1);
  expect(
    asked[0]?.type === "decision" ? asked[0].message.length : 0,
  ).toBeLessThanOrEqual(60);
  expect(owner.sent.map(({ decision }) => decision)).toEqual(["approve"]);
});

it("a confirmation that cannot be shown is reported once and the main question comes back without it", async () => {
  const { interaction } = person([
    { selected: ["always"] },
    { selected: ["approve"] },
  ]);
  const failures: unknown[] = [];
  // The second prompt, the Always confirmation, is the one the interaction refuses.
  const original = interaction.prompt.bind(interaction);
  vi.spyOn(interaction, "prompt")
    .mockImplementationOnce(original)
    .mockRejectedValueOnce(new Error("confirmation refused"))
    .mockImplementation(original);
  const owner = source({
    review: {
      form: "direct" as const,
      kind: "exec" as const,
      command: "git add hello.js",
      cwd: "/home/me/garden",
      justification: "Stage changes",
      prefix: ["git", "add"],
    },
  });
  expect(
    await askApproval(interaction, {
      ...options,
      view,
      source: owner,
      onFailure: (cause) => failures.push(cause),
    }),
  ).toEqual({ kind: "answered" });
  // Reported once, never denied, and the person's own choice is what is sent.
  expect(failures).toHaveLength(1);
  expect(owner.sent.map(({ decision }) => decision)).toEqual(["approve"]);
});

it("uses catalog labels without deriving names from IDs and keeps prose as a label", () => {
  const prose = {
    ...view,
    record: {
      ...view.record,
      description: {
        ...view.record.description,
        app: {
          displayName: "Field Notes",
          operationLabel: "Save a note. Replaces the existing text.",
        },
      },
    },
  };
  // Prose stays a label, never turned into a sentence; it is 61 characters
  // as a title, one over a prompt's limit, so it rides in a fact instead.
  const proseCard = approvalCardCopy(prose, undefined, options);
  expect(proseCard.content.title).toBe("Allow Field Notes to do this?");
  expect(proseCard.content.facts).toContainEqual({
    label: "Action",
    value: "Save a note. Replaces the existing text.",
  });
  const unlabelled = {
    ...view,
    record: {
      ...view.record,
      description: { inputBytes: 10, inputSha256: "a".repeat(64) },
    },
  };
  expect(approvalCardCopy(unlabelled, undefined, options).content.title).toBe(
    "Allow linear · create_issue?",
  );
});

it("a written reason denies with that note and a blank line is a plain Deny", async () => {
  const note = person([{ selected: [], text: "  Use the sandbox  " }]);
  const noted = source();
  await askApproval(note.interaction, { ...options, view, source: noted });
  expect(noted.sent).toEqual([
    {
      recordId: "record-1",
      decision: "deny",
      expectedRevision: 7,
      denialNote: "Use the sandbox",
    },
  ]);
  const plain = person([{ selected: ["deny"] }]);
  const blank = source();
  await askApproval(plain.interaction, { ...options, view, source: blank });
  expect(blank.sent.map(({ decision }) => decision)).toEqual(["deny"]);
});

it("Always allow needs a second answer whose escape is Back, and Back asks again", async () => {
  const review = {
    form: "direct" as const,
    kind: "exec" as const,
    command: "git add hello.js",
    cwd: "/home/me/garden",
    justification: "Stage changes",
    prefix: ["git", "add"],
  };
  const { interaction, asked } = person([
    { selected: ["always"] },
    { selected: ["back"] },
    { selected: ["always"] },
    { selected: ["always-allow"] },
  ]);
  const owner = source({ review });
  await askApproval(interaction, { ...options, view, source: owner });
  expect(asked).toHaveLength(4);
  // A prefix that fits its title needs no extra fact.
  expect(asked[1]).not.toHaveProperty("facts.0");
  expect(asked[1]).toMatchObject({
    type: "decision",
    escape: "back",
    options: [{ value: "back" }, { value: "always-allow" }],
  });
  expect(owner.sent.map(({ decision }) => decision)).toEqual(["always-allow"]);
});

it("nothing is sent for a record that is no longer the one shown", async () => {
  const { interaction } = person([{ selected: ["approve"] }]);
  const owner = source();
  const stale = await askApproval(interaction, {
    ...options,
    view,
    source: owner,
    stillCurrent: () => false,
  });
  expect(stale).toEqual({ kind: "abandoned" });
  expect(owner.sent).toEqual([]);
});

it("a refusal and a lost response both reach the person in words", async () => {
  const refused = source({
    answer: () =>
      Promise.resolve({ kind: "refused", reason: "stale-revision" }),
  });
  expect(
    await askApproval(person([{ selected: ["approve"] }]).interaction, {
      ...options,
      view,
      source: refused,
    }),
  ).toEqual({
    kind: "refused",
    message: "This request changed. Look again before answering.",
  });
  const failure = vi.fn();
  const lost = source({ answer: () => Promise.reject(new Error("gone")) });
  expect(
    await askApproval(person([{ selected: ["approve"] }]).interaction, {
      ...options,
      view,
      source: lost,
      onFailure: failure,
    }),
  ).toEqual({
    kind: "refused",
    message: "Couldn't send your answer. It may not have been recorded.",
  });
  expect(failure).toHaveBeenCalledOnce();
});

it("the family choice turns the rule on, then asks again without offering it twice", async () => {
  const enable = vi.fn(() => Promise.resolve(true));
  const owner = source({
    family: { label: "Always allow Notes to make changes", enable },
  });
  const { interaction, asked } = person([
    { selected: ["family"] },
    { selected: ["family"] },
    { selected: ["approve"] },
  ]);
  await askApproval(interaction, { ...options, view, source: owner });
  expect(enable).toHaveBeenCalledOnce();
  expect(asked[0]).toMatchObject({
    options: [{ value: "approve" }, { value: "family" }, { value: "deny" }],
  });
  expect(asked[2]).toMatchObject({
    summary: "Automatic approval is on for Notes.",
    options: [{ value: "approve" }, { value: "deny" }],
  });
});

it("the family rule needs its own confirmation, whose default and Esc are Back", async () => {
  const enable = vi.fn(() => Promise.resolve(true));
  const owner = source({
    family: { label: "Always allow Notes to make changes", enable },
  });
  const { interaction, asked } = person([
    { selected: ["family"] },
    { selected: ["back"] },
    { selected: ["deny"] },
  ]);
  await askApproval(interaction, { ...options, view, source: owner });
  expect(enable).not.toHaveBeenCalled();
  expect(asked[1]).toMatchObject({
    type: "decision",
    message: "Always allow Notes to make changes?",
    options: [{ value: "back" }, { value: "family" }],
    escape: "back",
  });
  expect(asked[2]).toMatchObject({
    options: [{ value: "approve" }, { value: "family" }, { value: "deny" }],
  });
  expect(owner.sent).toEqual([
    { recordId: "record-1", decision: "deny", expectedRevision: 7 },
  ]);
});

it("a command review keeps its title within a prompt's sixty characters and shortens home", () => {
  const card = approvalCardCopy(
    view,
    {
      form: "direct",
      kind: "exec",
      command: "git commit -m a very long message with many words in it indeed",
      cwd: "/home/me/garden",
      justification: "Stage changes",
    },
    { width: 100, home: "/home/me", now: 0 },
  );
  expect(card.content.title.length).toBeLessThanOrEqual(60);
  expect(card.content.facts?.[0]).toEqual({
    label: "Folder",
    value: "~/garden",
  });
  expect(approvalRefusal("not-eligible", "always-allow")).toContain(
    "Always allow isn't available",
  );
});

it("words every refusal reason without showing its code", () => {
  for (const reason of [
    "not-found",
    "not-eligible",
    "already-answered",
    "stale-revision",
    "expired",
    "declined",
    "fenced",
    "not-granted",
    "read-only",
    "pending",
    "in-flight",
    "outcome-unknown",
    "identity-conflict",
    "not-attached",
    "not-pending",
    "something-new",
  ]) {
    const words = approvalRefusal(reason, "approve");
    expect(words).not.toContain(`(${reason})`);
    expect(words).not.toMatch(/[a-z]+-[a-z]+/);
    expect(words).not.toMatch(/\(|\)/);
  }
  expect(approvalRefusal("not-found", "deny")).toBe(
    "This request is gone. Nothing ran. Ask the Agent to try again.",
  );
});

it("says nothing about undo for a reversible App write, and warns for an irreversible one", () => {
  const detail = (reversibility: string) =>
    approvalCardCopy(
      { ...view, record: { ...view.record, reversibility } },
      undefined,
      options,
    ).content.details?.map((entry) => entry.label) ?? [];
  expect(detail("reversible")).not.toContain("Undo");
  expect(detail("irreversible-external")).toContain("Undo");
});

it("names an App write by its own label and never as changing data", () => {
  const view = {
    canAnswer: true,
    record: {
      recordId: "record:1",
      revision: 1,
      requester: {
        displayName: "Shiitake",
        agentId: "agent:1",
        sessionId: "session:1",
        principalId: "agent:1",
      },
      module: "app:tourtois",
      operation: "layout.place",
      access: "write" as const,
      reversibility: "reversible" as const,
      expiresAt: 1_000_000,
      description: {
        app: {
          displayName: "Tourtois",
          operationLabel: "Add a widget to your dashboard",
        },
        inputBytes: 10,
        inputSha256: "0123456789abcdef".repeat(4),
      },
    },
  };
  const card = approvalCardCopy(view, undefined, options);
  expect(card.content.title).toBe(
    "Allow Tourtois to add a widget to your dashboard?",
  );
  expect(JSON.stringify(card.content)).not.toMatch(/Changes data|change data/u);
  expect(card.content.facts ?? []).toEqual([]);
});
