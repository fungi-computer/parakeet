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
  expect(approvalCardCopy(prose, undefined, options).content.title).toBe(
    "Allow Field Notes · Save a note. Replaces the existing text.?",
  );
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
    family: { label: "Always allow Notes to change data", enable },
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
    family: { label: "Always allow Notes to change data", enable },
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
    message: "Always allow Notes to change data?",
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
