import type { WhistleInteraction } from "@fungi.computer/whistle";
import { interactionTitleLimit } from "@fungi.computer/whistle/wire";

/** The ledger facts an approval card reads; the approvals ledger's own view satisfies it. */
export type ApprovalFacts = Readonly<{
  /** The durable record. */
  record: Readonly<{
    /** Identity of the record. */
    recordId: string;
    /** Changes whenever the record does; an answer names the revision it saw. */
    revision: number;
    /** Who asked. */
    requester: Readonly<{
      /** Name shown for the requesting Agent. */
      displayName: string;
      /** The Agent, when one asked. */
      agentId: string | null;
      /** The Session, when one asked. */
      sessionId: string | null;
      /** The principal that holds the request. */
      principalId: string;
    }>;
    /** The tool's module. */
    module: string;
    /** The tool's operation. */
    operation: string;
    /** Whether the tool writes inside Fungi or reaches outside it. */
    access: string;
    /** What the tool would be given, as the ledger describes it. */
    description: Readonly<{
      /** Display words supplied by the admitted App catalog, never derived from IDs. */
      app?: Readonly<{
        /** The App's published display name. */
        displayName: string;
        /** The operation's published human description. */
        operationLabel: string;
      }>;
      /** Size of the input in bytes. */
      inputBytes: number;
      /** Digest of the input. */
      inputSha256: string;
    }>;
    /** Whether the effect can be undone. */
    reversibility: string;
    /** When the request lapses. */
    expiresAt: number;
  }>;
  /** The holder may answer it. */
  canAnswer: boolean;
}>;

/** What the host knows about a command the Agent asked to run outside the sandbox. */
export type ApprovalReview = Readonly<{
  /** The command line. */
  command: string;
  /** Where it would run. */
  cwd: string;
  /** Why the Agent says it needs it. */
  justification: string;
  /** A direct program, or shell text. */
  form: "direct" | "shell";
  /** A command, or an extension install. */
  kind: "exec" | "extension-install";
  /** The program and its arguments, when direct. */
  argv?: readonly string[];
  /** The command words an Always-allow rule would match. */
  prefix?: readonly string[];
  /** Everything an Always-allow rule would cover. */
  alwaysAllowCoverage?: string;
  /** Why no Always-allow rule is offered. */
  alwaysAllowUnavailableReason?: string;
  /** What running this command, or a reusable rule for it, risks. */
  risk?: Readonly<{
    /** The risk in one sentence, named once above the confirmation. */
    summary: string;
    /** The risk in full, shown under Details. */
    detail: string;
  }>;
}>;

/** One labelled value in a card's facts or details. */
export type ApprovalEntry = Readonly<{
  /** What the value is. */
  label: string;
  /** The value. */
  value: string;
}>;

/** The words an approval prompt carries above its choices. */
export type ApprovalContent = Readonly<{
  /** The title. */
  title: string;
  /** One sentence under it. */
  summary?: string | undefined;
  /** Short labelled lines. */
  facts?: readonly ApprovalEntry[] | undefined;
  /** Long text, when the command is too long for a title. */
  body?: string | undefined;
  /** A short name for `body`. */
  bodyLabel?: string | undefined;
  /** Everything else, shown on demand. */
  details?: readonly ApprovalEntry[] | undefined;
}>;

const shorten = (value: string, width: number) => {
  if (value.length <= width) return value;
  const left = Math.max(1, Math.floor((width - 1) / 2));
  return `${value.slice(0, left)}…${value.slice(-(width - left - 1))}`;
};
const lead = (value: string, width: number) =>
  value.length <= width ? value : `${value.slice(0, width - 1)}…`;

/** Everything one approval shows, and what Always allow would confirm. */
export type ApprovalCard = Readonly<{
  /** The first prompt's words. */
  content: ApprovalContent;
  /** The Always-allow choice, when a rule is offered. */
  always?: string | undefined;
  /** What the Always-allow confirmation says. */
  confirmation?:
    | (ApprovalContent & {
        /** The rule's coverage, whole. */
        body: string;
      })
    | undefined;
  /** The risk named above the confirmation, once. */
  confirmWarning?: string | undefined;
  /** The confirming choice. */
  confirmYes?: string | undefined;
}>;

const entries = (pairs: readonly (readonly [string, string])[]) =>
  pairs.map(([label, value]) => ({ label, value }));

function recordDetails(
  view: ApprovalFacts,
  now: number,
): readonly (readonly [string, string])[] {
  const { record } = view;
  const remaining = Math.max(0, record.expiresAt - now);
  return [
    [
      "Agent",
      `${record.requester.displayName} · ${record.requester.agentId ?? "none"}`,
    ],
    ["Session", record.requester.sessionId ?? "none"],
    ["Requester", record.requester.principalId],
    ["Request", `${record.module}.${record.operation} · ${record.access}`],
    [
      "Input",
      `${record.description.inputBytes.toLocaleString()} bytes · SHA-256 ${record.description.inputSha256.slice(0, 8)}…${record.description.inputSha256.slice(-6)}`,
    ],
    [
      "Expires",
      `in ${String(Math.floor(remaining / 3_600_000))} h ${String(Math.floor((remaining % 3_600_000) / 60_000))} m`,
    ],
    ["Record", `${record.recordId} · revision ${String(record.revision)}`],
  ];
}

function undoDetail(view: ApprovalFacts): readonly [string, string] {
  return [
    "Undo",
    view.record.reversibility === "irreversible-external"
      ? "Can't be undone"
      : "Can be undone",
  ];
}

function appApprovalTitle(
  app: NonNullable<ApprovalFacts["record"]["description"]["app"]>,
): string {
  // A short catalog action can be embedded in a question. Prose stays a label;
  // never attempt to turn a module/operation identifier into display words.
  const action = app.operationLabel.trim().replace(/\.$/, "");
  if (action.length === 0 || /[.!?\n]/.test(action))
    return `Allow ${app.displayName} · ${app.operationLabel}?`;
  return `Allow ${app.displayName} to ${action.charAt(0).toLowerCase()}${action.slice(1)}?`;
}

function connectedToolCard(view: ApprovalFacts, now: number): ApprovalCard {
  const { record } = view;
  const app = record.description.app;
  const wanted =
    app === undefined
      ? `Allow ${record.module} · ${record.operation}?`
      : appApprovalTitle(app);
  // An App's own words can run past a title. Then the title stays short and the
  // whole action moves to a fact, so a long description never costs the person
  // the question: a prompt over the limit is refused and nothing is shown.
  const fits = wanted.length <= interactionTitleLimit;
  const subject = lead(app?.displayName ?? record.module, 28);
  const title = fits
    ? wanted
    : lead(`Allow ${subject} to do this?`, interactionTitleLimit);
  const action =
    app === undefined
      ? `${record.module}.${record.operation}`
      : app.operationLabel;
  return {
    content: {
      title,
      // The request is parked, not held by a live turn: it waits as long as
      // the person takes and the Agent carries on once they answer.
      summary:
        (app === undefined
          ? `${record.requester.displayName} wants to use a connected tool.`
          : record.access === "write"
            ? `${record.requester.displayName} wants to make a change in ${app.displayName}.`
            : `${record.requester.displayName} wants to act outside Fungi through ${app.displayName}.`) +
        " The Agent continues after you answer.",
      facts: [
        ...(fits ? [] : [{ label: "Action", value: action }]),
        // An App's write is already named by its own plain label in the title
        // or the Action fact; "Changes data in Fungi" only alarms. Reaching
        // outside Fungi and an undoable-never write still say so.
        ...(record.access === "write" && app !== undefined
          ? record.reversibility === "irreversible-external"
            ? [{ label: "Effect", value: "Can't be undone" }]
            : []
          : [
              {
                label: "Effect",
                value:
                  (record.access === "write"
                    ? "Changes data in Fungi"
                    : "Changes things outside Fungi") +
                  (record.reversibility === "irreversible-external"
                    ? " · can't be undone"
                    : ""),
              },
            ]),
      ],
      // Nothing backs "can be undone" for an App write, so only a warning shows.
      details: entries([
        ...(record.reversibility === "irreversible-external"
          ? [undoDetail(view)]
          : []),
        ...recordDetails(view, now),
      ]),
    },
  };
}

function escapeCard(
  view: ApprovalFacts,
  review: ApprovalReview,
  width: number,
  home: string,
  now: number,
): ApprovalCard {
  const prefix = review.prefix?.join(" ");
  const offered =
    prefix !== undefined && review.alwaysAllowUnavailableReason === undefined;
  const command = review.command;
  const title =
    `Allow \`${command}\`?`.length <= width
      ? `Allow \`${command}\`?`
      : "Allow this command?";
  const folder =
    review.cwd === home
      ? "~"
      : review.cwd.startsWith(`${home}/`)
        ? `~${review.cwd.slice(home.length)}`
        : review.cwd;
  const reasonWidth = Math.max(8, (width - 8) * 2 - 2);
  const reason =
    review.justification.length <= reasonWidth
      ? `“${review.justification}”`
      : `“${review.justification.slice(0, reasonWidth - 1)}…”`;
  const facts: [string, string][] = [
    ["Folder", shorten(folder, Math.max(8, width - 10))],
    ["Why", reason],
  ];
  if (review.kind === "extension-install")
    facts.push([
      "Note",
      "Extensions run inside Fungi with access to every Agent.",
    ]);
  // The complete host-provided coverage stays in Details; the main card has a
  // one-line preview so long Git option lists cannot displace the choices.
  if (offered && review.alwaysAllowCoverage !== undefined)
    facts.push([
      "Scope",
      lead(review.alwaysAllowCoverage, Math.max(8, width - 12)),
    ]);
  // An offered rule names its risk once, above the confirmation instead.
  if (!offered && review.risk !== undefined)
    facts.push(["Risk", review.risk.summary]);
  const always = !offered
    ? undefined
    : `Always allow “${shorten(prefix, Math.max(8, width - 5 - "Always allow “” in this project…".length))}” in this project…`;
  const details: (readonly [string, string])[] = [["Command", command]];
  if (review.argv !== undefined)
    details.push(["Arguments", JSON.stringify(review.argv)]);
  details.push(
    ["Folder", review.cwd],
    ["Runs", "Outside the sandbox, as you"],
    undoDetail(view),
  );
  if (!offered && review.alwaysAllowUnavailableReason !== undefined)
    details.push(["Rule", review.alwaysAllowUnavailableReason]);
  else if (review.form === "shell")
    details.push(["Rule", "Shell command: no Always-allow rule can match it."]);
  else if (offered) {
    details.push([
      "Rule",
      `“${prefix}” would match \`${prefix} …\` in this project`,
    ]);
    if (review.alwaysAllowCoverage !== undefined)
      details.push(["Coverage", review.alwaysAllowCoverage]);
  }
  // Details replace the preview by label, so the risk shows once.
  if (review.risk !== undefined) details.push(["Risk", review.risk.detail]);
  details.push(...recordDetails(view, now));
  return {
    content: {
      title,
      body: title === "Allow this command?" ? command : undefined,
      bodyLabel: title === "Allow this command?" ? "Command" : undefined,
      summary: `${view.record.requester.displayName} wants to run this outside the sandbox, as you.`,
      facts: entries(facts),
      details: entries(details),
    },
    always:
      always === undefined ? undefined : lead(always, Math.max(12, width - 5)),
    confirmation: !offered
      ? undefined
      : {
          title: lead(
            `Always allow “${prefix}” in this project?`,
            interactionTitleLimit,
          ),
          // A standing rule shows exactly what it allows: when the title has
          // to cut the prefix, the whole prefix is a fact on the confirmation.
          facts:
            `Always allow “${prefix}” in this project?`.length >
            interactionTitleLimit
              ? [{ label: "Command prefix", value: prefix }]
              : undefined,
          body: lead(
            review.alwaysAllowCoverage ??
              `Any Workspace Agent here can then run \`${prefix} …\` without asking.`,
            Math.max(12, (width - 8) * 2 - 2),
          ),
        },
    confirmWarning: offered ? review.risk?.summary : undefined,
    confirmYes: !offered
      ? undefined
      : `Always allow “${prefix}” and run it now`,
  };
}

/**
 * The words of one approval. A connected tool gets its effect; a command the
 * Agent wants to run outside the sandbox gets its folder, reason and rule.
 * `home` shortens paths inside it to `~`; `now` dates the expiry.
 */
export function approvalCardCopy(
  view: ApprovalFacts,
  review: ApprovalReview | undefined,
  options: Readonly<{ width: number; home: string; now: number }>,
): ApprovalCard {
  // A prompt's title is at most sixty characters.
  const width = Math.min(options.width, interactionTitleLimit);
  return review === undefined
    ? connectedToolCard(view, options.now)
    : escapeCard(view, review, width, options.home, options.now);
}

/** What an answer was refused for, in words for the person. */
export function approvalRefusal(
  reason: string,
  decision: "approve" | "deny" | "always-allow",
) {
  switch (reason) {
    case "stale-revision":
    case "already-answered":
    case "not-pending":
      return "This request changed. Look again before answering.";
    case "expired":
      return "This request expired. Nothing ran.";
    case "not-found":
      return "This request is gone. Nothing ran. Ask the Agent to try again.";
    case "declined":
      return "This request was already denied. Nothing ran.";
    case "not-eligible":
      return decision === "always-allow"
        ? "Always allow isn't available for this command. Approve once or deny."
        : "You can't answer this request. Nothing ran. Ask whoever owns it.";
    case "not-granted":
    case "read-only":
      return "You aren't allowed to answer this request. Nothing ran. Ask whoever owns it.";
    case "fenced":
    case "identity-conflict":
      return "This request no longer matches what you saw. Nothing ran. Refresh and look again.";
    case "pending":
      return "This request hasn't been answered yet. Answer it first.";
    case "in-flight":
      return "This is already running. Wait for it to finish.";
    case "outcome-unknown":
      return "We can't tell whether this ran. Check before trying again.";
    case "not-attached":
      return "This session isn't connected anymore. Reconnect and try again. Nothing ran.";
    default:
      return "Couldn't answer this request. Nothing ran. Try again.";
  }
}

/** What the person decided. */
export type ApprovalDecision = "approve" | "deny" | "always-allow";

/** A decision, pinned to the revision the person saw. */
export type ApprovalAnswerInput = Readonly<{
  /** The record being answered. */
  recordId: string;
  /** Approve once, deny, or approve and keep a rule. */
  decision: ApprovalDecision;
  /** The revision on screen; a changed record refuses the answer. */
  expectedRevision: number;
  /** Why it was denied, when the person said. */
  denialNote?: string;
}>;

/** How the owner took an answer; a refusal names its reason. */
export type ApprovalAnswerResult = Readonly<{
  /** `refused`, or whatever else the owner calls an accepted answer. */
  kind: string;
  /** Why it was refused. */
  reason?: string;
}>;

/** Where approvals come from and where answers go. */
export type ApprovalSource = Readonly<{
  /** The record being shown, when there is one. */
  snapshot: () => ApprovalFacts | undefined;
  /** Observe the record changing. */
  subscribe: (listener: () => void) => () => void;
  /** What the host knows about the command, for an escape review. */
  review?: ApprovalReview | undefined;
  /** Answer it; a refusal names its reason. */
  answer: (input: ApprovalAnswerInput) => Promise<ApprovalAnswerResult>;
  /** Let the whole family of this tool through from now on, where the surface can. */
  family?:
    | Readonly<{
        /** The choice's name. */
        label: string;
        /** Turn the rule on; false when it was refused. */
        enable: () => Promise<boolean>;
      }>
    | undefined;
}>;

/** The answer was sent. */
export type ApprovalAnswered = Readonly<{
  /** Discriminant. */
  kind: "answered";
}>;

/** The answer was refused, or could not be sent. */
export type ApprovalRefused = Readonly<{
  /** Discriminant. */
  kind: "refused";
  /** What to tell the person. */
  message: string;
}>;

/** The record changed or went away before an answer was sent. */
export type ApprovalAbandoned = Readonly<{
  /** Discriminant. */
  kind: "abandoned";
}>;

/** How asking ended. */
export type ApprovalOutcome =
  ApprovalAnswered | ApprovalRefused | ApprovalAbandoned;

/** What the Agent reads when its approval could not be put in front of the person. */
const unshowableNote =
  "The approval request could not be shown to the member, so it was not approved. Nothing ran.";
/** What the person reads when their request could not be put in front of them. */
const unshowableToast =
  "Couldn't show this request, so it was denied. Nothing ran. Ask your Agent to try again.";
const failureMessage =
  "Couldn't send your answer. It may not have been recorded.";

/**
 * Ask the person about one approval through a conversation's decision
 * prompts, then send the answer. Nothing is sent until Enter answers, Always
 * allow and the family rule each need a second, separate confirmation whose
 * default is Back, and an
 * answer is only sent while the record is still the one that was shown.
 */
export async function askApproval(
  interaction: WhistleInteraction,
  input: Readonly<{
    view: ApprovalFacts;
    source: ApprovalSource;
    home: string;
    width: number;
    now: number;
    /** The longest denial note. */
    noteLimit: number;
    /** The record on screen is still the current one. */
    stillCurrent: () => boolean;
    /** An error reached the person as a refusal; report its cause. */
    onFailure: (cause: unknown) => void;
    /**
     * A prompt could not be shown at all, so the request was denied for the
     * person: the one message to show them, in plain words.
     */
    onUnshowable?: ((message: string) => void) | undefined;
  }>,
): Promise<ApprovalOutcome> {
  const { view, source } = input;
  // True only while a prompt is being put in front of the person, so a prompt
  // the interaction refuses is kept apart from every other failure.
  let prompting = false;
  const card = approvalCardCopy(view, source.review, {
    width: input.width,
    home: input.home,
    now: input.now,
  });
  const record = view.record;
  try {
    let decision: ApprovalDecision | undefined;
    let denialNote: string | undefined;
    let familyOn = false;
    // A confirmation the interaction refuses is dropped, never answered for the person.
    let alwaysRefused = false;
    let familyRefused = false;
    while (decision === undefined) {
      prompting = true;
      const answer = await interaction.prompt({
        type: "decision",
        message: lead(card.content.title, interactionTitleLimit),
        summary: familyOn
          ? `Automatic approval is on for ${record.description.app?.displayName ?? "this tool"}.`
          : card.content.summary,
        facts: card.content.facts?.map((fact) => ({ ...fact })),
        body: card.content.body,
        bodyLabel: card.content.bodyLabel,
        details: card.content.details?.map((entry) => ({ ...entry })),
        options: [
          { value: "approve", label: "Approve once" },
          ...(card.always === undefined || alwaysRefused
            ? []
            : [{ value: "always", label: card.always }]),
          ...(source.family === undefined || familyOn || familyRefused
            ? []
            : [{ value: "family", label: source.family.label }]),
          { value: "deny", label: "Deny" },
        ],
        other: {
          label: "Deny and say why…",
          placeholder: "A short reason for the Agent (optional)",
          maxLength: input.noteLimit,
          blank: "deny",
        },
      });
      prompting = false;
      if (!input.stillCurrent()) return { kind: "abandoned" };
      if (answer.text !== undefined) {
        denialNote = answer.text.trim() || undefined;
        decision = "deny";
      } else if (answer.selected[0] === "always") {
        const confirmation = card.confirmation;
        let confirmed;
        try {
          confirmed = await interaction.prompt({
            type: "decision",
            message: lead(
              confirmation?.title ?? card.content.title,
              interactionTitleLimit,
            ),
            summary: card.confirmWarning,
            facts: confirmation?.facts?.map((fact) => ({ ...fact })),
            body: confirmation?.body,
            options: [
              { value: "back", label: "Back" },
              {
                value: "always-allow",
                label: card.confirmYes ?? "Always allow",
              },
            ],
            escape: "back",
          });
        } catch (cause) {
          if (interaction.signal.aborted) throw cause;
          // The main question comes back without this option; nothing is denied.
          input.onFailure(cause);
          alwaysRefused = true;
          continue;
        }
        if (!input.stillCurrent()) return { kind: "abandoned" };
        if (confirmed.selected[0] === "always-allow") decision = "always-allow";
      } else if (
        answer.selected[0] === "family" &&
        source.family !== undefined
      ) {
        // A standing rule, like Always allow: it needs its own confirmation.
        let confirmed;
        try {
          confirmed = await interaction.prompt({
            type: "decision",
            message: lead(`${source.family.label}?`, interactionTitleLimit),
            summary: `All ${record.description.app?.displayName ?? "this tool"} requests that ${record.access === "write" ? "make changes" : "reach outside Fungi"} will run without asking, not just this action.`,
            options: [
              { value: "back", label: "Back" },
              { value: "family", label: source.family.label },
            ],
            escape: "back",
          });
        } catch (cause) {
          if (interaction.signal.aborted) throw cause;
          input.onFailure(cause);
          familyRefused = true;
          continue;
        }
        if (!input.stillCurrent()) return { kind: "abandoned" };
        if (confirmed.selected[0] === "family") {
          familyOn = await source.family.enable();
          if (!input.stillCurrent()) return { kind: "abandoned" };
        }
      } else if (answer.selected[0] === "approve") decision = "approve";
      else if (answer.selected[0] === "deny") decision = "deny";
    }
    const pinned = {
      recordId: record.recordId,
      decision,
      expectedRevision: record.revision,
    } satisfies ApprovalAnswerInput;
    const result = await source.answer(
      denialNote === undefined ? pinned : { ...pinned, denialNote },
    );
    if (!input.stillCurrent()) return { kind: "abandoned" };
    return result.kind === "refused"
      ? {
          kind: "refused",
          message: approvalRefusal(result.reason ?? "unknown", decision),
        }
      : { kind: "answered" };
  } catch (cause) {
    if (interaction.signal.aborted) return { kind: "abandoned" };
    if (prompting) {
      // The question itself could not be shown, so nothing was ever asked and
      // nothing can be approved: end the Agent's call now with a named reason
      // instead of leaving it to its deadline. Reported once.
      let reported: unknown = cause;
      try {
        await source.answer({
          recordId: view.record.recordId,
          decision: "deny",
          expectedRevision: view.record.revision,
          denialNote: unshowableNote,
        });
      } catch (denyCause) {
        reported = denyCause;
      }
      input.onFailure(reported);
      input.onUnshowable?.(unshowableToast);
      return { kind: "refused", message: failureMessage };
    }
    input.onFailure(cause);
    return { kind: "refused", message: failureMessage };
  }
}
