import { describe, expect, it } from "vitest";
import {
  initialViewState,
  transition,
  type ConversationTarget,
  type ViewEvent,
  type ViewState,
} from "../src/conversation-view.js";

const a: ConversationTarget = { agentId: "agent", sessionId: "a" };
const b: ConversationTarget = { agentId: "agent", sessionId: "b" };
const c: ConversationTarget = { agentId: "agent", sessionId: "c" };

type C = ConversationTarget;
type S = ViewState;

const none: S = initialViewState;
const open = (conversation: C, awaitingRoute?: C | null): S => ({
  ...none,
  view: { kind: "open", conversation },
  awaitingRoute,
});
const opening = (
  target: C,
  cause: "person" | "host" | "route" | "auto",
  previous: C | null = null,
  awaitingRoute?: C | null,
): S => ({
  ...none,
  view: { kind: "opening", target, cause, previous },
  awaitingRoute,
});
const creating = (cause: "person" | "auto", base: S = none, ticket = 7): S => ({
  ...base,
  creating: { ticket, cause },
  nextTicket: ticket + 1,
});

const kinds = (state: S) => state.view.kind;
const run = (state: S, ...events: ViewEvent[]) =>
  events.reduce((current, event) => transition(current, event).state, state);

describe("rule 1: a choice beats automatic causes, newest wins", () => {
  it("opens and navigates a person's choice from every state", () => {
    for (const from of [
      none,
      open(a),
      opening(a, "person"),
      opening(a, "auto"),
      creating("auto"),
      creating("person"),
    ]) {
      const next = transition(from, {
        type: "select",
        target: b,
        cause: "person",
      });
      expect(next.state.view).toMatchObject({
        kind: "opening",
        target: b,
        cause: "person",
      });
      expect(next.state.creating).toBeNull();
      expect(next.state.awaitingRoute).toEqual(b);
      expect(next.effects).toEqual([
        { type: "open", target: b, fromHost: false },
        { type: "navigate", target: b },
      ]);
    }
  });

  it("marks a host request as such", () => {
    const next = transition(none, {
      type: "select",
      target: a,
      cause: "host",
    });
    expect(next.effects[0]).toEqual({
      type: "open",
      target: a,
      fromHost: true,
    });
  });

  it("keeps what is open as the fallback while a choice opens", () => {
    const next = transition(open(a), {
      type: "select",
      target: b,
      cause: "person",
    });
    expect(next.state.view).toMatchObject({ kind: "opening", previous: a });
  });

  it("the newest choice replaces an earlier one still opening", () => {
    const state = run(
      none,
      { type: "select", target: a, cause: "person" },
      { type: "select", target: b, cause: "person" },
    );
    expect(state.view).toMatchObject({ kind: "opening", target: b });
  });

  it("re-choosing what is in view only re-mirrors the route", () => {
    for (const from of [open(a), opening(a, "person")]) {
      const next = transition(from, {
        type: "select",
        target: a,
        cause: "person",
      });
      expect(next.state.view).toEqual(from.view);
      expect(next.effects).toEqual([{ type: "navigate", target: a }]);
    }
  });

  it("returning to the conversation still open cancels the opening", () => {
    const next = transition(opening(b, "person", a, b), {
      type: "select",
      target: a,
      cause: "person",
    });
    expect(next.state.view).toEqual({ kind: "open", conversation: a });
    expect(next.effects).toEqual([
      { type: "open", target: a, fromHost: false },
      { type: "navigate", target: a },
    ]);
  });

  it("a Session created for a superseded request is not shown", () => {
    const requested = transition(none, { type: "create", cause: "person" });
    const chosen = transition(requested.state, {
      type: "select",
      target: c,
      cause: "person",
    }).state;
    const late = transition(chosen, {
      type: "created",
      ticket: requested.ticket ?? 0,
      target: b,
    });
    expect(late.accepted).toBe(false);
    expect(late.state).toEqual(chosen);
    expect(late.effects).toEqual([]);
  });

  it("a person's Session replaces what is in view when it arrives", () => {
    const requested = transition(open(a), { type: "create", cause: "person" });
    expect(requested.accepted).toBe(true);
    const created = transition(requested.state, {
      type: "created",
      ticket: requested.ticket ?? 0,
      target: b,
    });
    expect(created.accepted).toBe(true);
    expect(created.state.view).toMatchObject({
      kind: "opening",
      target: b,
      previous: a,
    });
    expect(created.effects).toEqual([
      { type: "open", target: b, fromHost: false },
      { type: "navigate", target: b },
    ]);
  });
});

describe("rule 2: auto-open starts only from none", () => {
  it("is accepted from none only", () => {
    const accepted = transition(none, { type: "create", cause: "auto" });
    expect(accepted.accepted).toBe(true);
    expect(accepted.state.creating).toEqual({ ticket: 1, cause: "auto" });
    const refusedFrom: S[] = [
      open(a),
      opening(a, "person"),
      opening(a, "route"),
      creating("person"),
      creating("auto"),
      { ...none, awaitingRoute: a },
    ];
    for (const from of refusedFrom) {
      const refused = transition(from, { type: "create", cause: "auto" });
      expect(refused.accepted).toBe(false);
      expect(refused.state).toEqual(from);
    }
  });

  it("never displaces what is in view when its Session arrives late", () => {
    const requested = transition(none, { type: "create", cause: "auto" });
    // The person opened a conversation while the Session was being created.
    const chosen = run(requested.state, {
      type: "select",
      target: a,
      cause: "person",
    });
    const late = transition(chosen, {
      type: "created",
      ticket: requested.ticket ?? 0,
      target: b,
    });
    expect(late.accepted).toBe(false);
    expect(kinds(late.state)).toBe("opening");
    expect(late.state.view).toMatchObject({ target: a });
  });

  it("opens its own Session from none, without moving the route", () => {
    const requested = transition(none, { type: "create", cause: "auto" });
    const created = transition(requested.state, {
      type: "created",
      ticket: requested.ticket ?? 0,
      target: a,
    });
    expect(created.accepted).toBe(true);
    expect(created.state.view).toMatchObject({
      kind: "opening",
      cause: "auto",
    });
  });
});

describe("rule 3: the route mirrors the view", () => {
  it("a route naming what is in view or opening is a no-op", () => {
    for (const from of [open(a), opening(a, "person")]) {
      const next = transition(from, { type: "route", target: a });
      expect(next.state).toEqual({ ...from, route: a });
      expect(next.effects).toEqual([]);
    }
  });

  it("a choice's own echo settles the wait, and nothing else", () => {
    const waiting = opening(b, "person", a, b);
    expect(transition(waiting, { type: "route", target: b }).state).toEqual({
      ...waiting,
      awaitingRoute: undefined,
      route: b,
    });
  });

  it("ignores the route as it was before the choice (the stale echo)", () => {
    const waiting = opening(b, "person", a, b);
    for (const stale of [a, null, c]) {
      const next = transition(waiting, { type: "route", target: stale });
      expect(next.state).toEqual({ ...waiting, route: stale });
      expect(next.effects).toEqual([]);
    }
    // Run 3's race: autoOpen's route (a) is echoed after the person chose b.
    const afterChoice = run(
      open(a),
      { type: "select", target: b, cause: "person" },
      { type: "route", target: a },
    );
    expect(afterChoice.view).toMatchObject({ kind: "opening", target: b });
  });

  it("opens a route that is not what is in view when no choice is waiting", () => {
    for (const from of [none, open(a)]) {
      const next = transition(from, { type: "route", target: b });
      expect(next.state.view).toMatchObject({
        kind: "opening",
        target: b,
        cause: "route",
      });
      expect(next.state.awaitingRoute).toBeUndefined();
      expect(next.effects).toEqual([
        { type: "open", target: b, fromHost: false },
      ]);
    }
  });

  it("leaving the conversation clears the view; with nothing open it is a no-op", () => {
    const left = transition(open(a), { type: "route", target: null });
    expect(left.state.view).toEqual({ kind: "none" });
    expect(left.effects).toEqual([{ type: "clear" }]);
    const idle = transition(none, { type: "route", target: null });
    expect(idle.state).toEqual(none);
    expect(idle.effects).toEqual([]);
  });

  it("a person's pending Session is not undone by a route change", () => {
    const pending = creating("person", open(a));
    for (const target of [null, b]) {
      const next = transition(pending, { type: "route", target });
      expect(next.state).toEqual({ ...pending, route: target });
      expect(next.effects).toEqual([]);
    }
  });

  it("a route change while an automatic opening is under way may take over", () => {
    const next = transition(opening(a, "auto"), { type: "route", target: b });
    expect(next.state.view).toMatchObject({ kind: "opening", target: b });
  });
});

describe("opened and failed", () => {
  it("opened settles the matching opening only", () => {
    const next = transition(opening(a, "person", b), {
      type: "opened",
      conversation: a,
    });
    expect(next.state.view).toEqual({ kind: "open", conversation: a });
    for (const from of [none, open(a), opening(b, "person")]) {
      const stale = transition(from, { type: "opened", conversation: a });
      expect(stale.accepted).toBe(from.view.kind === "open" ? false : false);
      expect(stale.state).toEqual(from);
    }
  });

  it("a failed opening returns to what was open, or to none, and the route follows", () => {
    const back = transition(opening(b, "person", a, b), {
      type: "open-failed",
    });
    expect(back.state.view).toEqual({ kind: "open", conversation: a });
    expect(back.state.awaitingRoute).toEqual(a);
    expect(back.effects).toEqual([{ type: "navigate", target: a }]);
    const none2 = transition(opening(b, "person", null, b), {
      type: "open-failed",
    });
    expect(none2.state.view).toEqual({ kind: "none" });
    expect(none2.state.awaitingRoute).toBeNull();
    expect(none2.effects).toEqual([{ type: "navigate", target: null }]);
    for (const from of [none, open(a)]) {
      const next = transition(from, { type: "open-failed" });
      expect(next.accepted).toBe(false);
      expect(next.state).toEqual(from);
    }
  });

  it("the failed choice's late route echo does not reopen it", () => {
    const state = run(
      open(a),
      { type: "select", target: b, cause: "person" },
      { type: "open-failed" },
      { type: "route", target: b },
      { type: "route", target: a },
    );
    expect(state.view).toEqual({ kind: "open", conversation: a });
    expect(state.awaitingRoute).toBeUndefined();
  });

  it("a failed Session creation frees only its own request", () => {
    const requested = creating("person", none, 3);
    expect(
      transition(requested, { type: "create-failed", ticket: 3 }).state
        .creating,
    ).toBeNull();
    expect(
      transition(requested, { type: "create-failed", ticket: 9 }).state,
    ).toEqual(requested);
  });
});

describe("leave and reset", () => {
  it("leave clears from every state and navigates home when the route is elsewhere", () => {
    for (const base of [
      none,
      open(a),
      opening(a, "person"),
      creating("person"),
    ]) {
      const from = { ...base, route: a };
      const home = transition(from, { type: "leave", navigate: true });
      expect(home.state.view).toEqual({ kind: "none" });
      expect(home.state.creating).toBeNull();
      expect(home.state.awaitingRoute).toBeNull();
      expect(home.effects).toEqual([
        { type: "clear" },
        { type: "navigate", target: null },
      ]);
      const quiet = transition(from, { type: "leave", navigate: false });
      expect(quiet.state.awaitingRoute).toBeUndefined();
      expect(quiet.effects).toEqual([{ type: "clear" }]);
    }
  });

  it("reset forgets everything a replaced opener opened", () => {
    for (const from of [
      open(a),
      opening(a, "person", null, a),
      creating("auto"),
    ]) {
      const next = transition(from, { type: "reset" });
      expect(next.state.view).toEqual({ kind: "none" });
      expect(next.state.creating).toBeNull();
      expect(next.state.awaitingRoute).toBeUndefined();
      expect(next.effects).toEqual([]);
    }
  });

  it("leaving then the echo of the home route settles quietly", () => {
    const state = run(
      { ...open(a), route: a },
      { type: "leave", navigate: true },
      { type: "route", target: null },
    );
    expect(state.view).toEqual({ kind: "none" });
    expect(state.awaitingRoute).toBeUndefined();
  });
});

describe("a navigation that the router never echoes", () => {
  const shows = (state: S, route: C | null): S => ({ ...state, route });

  it("asks for no navigation to the URL already shown, and waits for nothing", () => {
    // Re-choosing what the route already shows.
    const same = transition(shows(open(a), a), {
      type: "select",
      target: a,
      cause: "person",
    });
    expect(same.effects).toEqual([]);
    expect(same.state.awaitingRoute).toBeUndefined();
    // Returning to the open conversation while another opens, route unmoved.
    const back = transition(shows(opening(b, "person", a), a), {
      type: "select",
      target: a,
      cause: "person",
    });
    expect(back.effects).toEqual([
      { type: "open", target: a, fromHost: false },
    ]);
    expect(back.state.awaitingRoute).toBeUndefined();
    // Later route changes still count: back/forward works.
    const later = transition(back.state, { type: "route", target: b });
    expect(later.state.view).toMatchObject({ kind: "opening", target: b });
  });

  it("leaving when the route is already the list asks for no navigation", () => {
    const left = transition(shows(open(a), null), {
      type: "leave",
      navigate: true,
    });
    expect(left.effects).toEqual([{ type: "clear" }]);
    expect(left.state.awaitingRoute).toBeUndefined();
  });

  it("a replaced navigation is settled by the router's confirmation", () => {
    const state = run(
      shows(open(a), a),
      { type: "select", target: b, cause: "person" },
      { type: "select", target: c, cause: "person" },
    );
    expect(state.awaitingRoute).toEqual(c);
    // The router finished b's navigation as c's replaced it: not our wait.
    const early = transition(state, { type: "route-confirmed", target: b });
    expect(early.state.awaitingRoute).toEqual(c);
    // It never echoes c, but confirms where it ended up.
    const settled = transition(early.state, {
      type: "route-confirmed",
      target: c,
    });
    expect(settled.state.awaitingRoute).toBeUndefined();
    // Back/forward and deep links work again.
    const next = transition(settled.state, { type: "route", target: a });
    expect(next.state.view).toMatchObject({ kind: "opening", target: a });
  });

  it("a navigation to a conversation that was already shown is settled by its confirmation", () => {
    // The router reports a (still shown) after the asked-for navigation to a.
    const state = run(
      shows(open(b), b),
      { type: "select", target: a, cause: "person" },
      { type: "select", target: b, cause: "person" },
    );
    // Route never left b from the router's view; it confirms b.
    expect(state.awaitingRoute).toEqual(b);
    const settled = transition(state, { type: "route-confirmed", target: b });
    expect(settled.state.awaitingRoute).toBeUndefined();
  });

  it("open-failed where the URL never left the previous conversation", () => {
    // The route is observed at a and no navigation to b was ever issued.
    const failed = transition(shows(opening(b, "route", a), a), {
      type: "open-failed",
    });
    expect(failed.state.view).toEqual({ kind: "open", conversation: a });
    expect(failed.effects).toEqual([]);
    expect(failed.state.awaitingRoute).toBeUndefined();
    // A later route change is not swallowed.
    const next = transition(failed.state, { type: "route", target: c });
    expect(next.state.view).toMatchObject({ kind: "opening", target: c });
  });

  it("open-failed before the choice's echo overrides the outstanding navigation and is settled by its confirmation", () => {
    const failed = run(
      shows(open(a), a),
      { type: "select", target: b, cause: "person" },
      { type: "open-failed" },
    );
    expect(failed.awaitingRoute).toEqual(a);
    const settled = transition(failed, { type: "route-confirmed", target: a });
    expect(settled.state.awaitingRoute).toBeUndefined();
    expect(settled.state.view).toEqual({ kind: "open", conversation: a });
  });

  it("open-failed with nothing open and the route already the list asks for nothing", () => {
    const failed = transition(shows(opening(b, "route", null), null), {
      type: "open-failed",
    });
    expect(failed.state.view).toEqual({ kind: "none" });
    expect(failed.effects).toEqual([]);
    expect(failed.state.awaitingRoute).toBeUndefined();
  });

  it("every route observation updates where the router is", () => {
    const state = run(shows(opening(b, "person", a, b), a), {
      type: "route",
      target: a,
    });
    expect(state.route).toEqual(a);
    expect(state.awaitingRoute).toEqual(b);
  });
});

describe("created checks the auto cause before choosing", () => {
  it("an automatic Session arriving after something is in view changes nothing", () => {
    const state = creating("auto", open(a), 4);
    const late = transition(state, { type: "created", ticket: 4, target: b });
    expect(late.accepted).toBe(false);
    expect(late.effects).toEqual([]);
    expect(late.state.view).toEqual({ kind: "open", conversation: a });
    expect(late.state.creating).toBeNull();
  });
});
