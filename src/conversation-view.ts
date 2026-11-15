import type { AppRoot } from "@fungi.computer/agar";
import type { QueryClient } from "@tanstack/react-query";
import type { ShiitakeSession } from "@fungi.computer/shiitake/client";
import {
  createConversationOpeningOwner,
  type OpenConversation,
  type OpeningServices,
} from "./conversation-opening.js";
import type { ParakeetSession } from "./headless.js";

/**
 * Which conversation is in view, decided in one place.
 *
 * Several things can ask Grove to show a conversation: the person (a row, New
 * conversation, a starter), the host (an open request), the route (a history
 * echo or back/forward) and Grove itself (the first conversation it opens when
 * there is nothing to pick up). Each used to act on its own, so any of them
 * could win a race and swap the pane under someone who was already typing.
 *
 * This reducer is the single owner. Its rules:
 *
 * 1. A person's or the host's choice beats every automatic cause, and the
 *    newest such choice wins. It also voids any Session still being created.
 * 2. Auto-open starts only from `none`: nothing in view, nothing opening,
 *    nothing being created.
 * 3. The route mirrors the view. A route change naming what is in view or
 *    opening is a no-op, and while a choice's own route echo is outstanding,
 *    other route values are stale echoes and are ignored.
 * 4. The view only ever shows a Session that has finished opening, so a
 *    composer is bound to the `open` Session; while another is `opening`, the
 *    pane is not typeable.
 */

export type ConversationTarget = Readonly<{
  agentId: string;
  sessionId: string;
}>;

/** Who asked for a conversation to be shown. */
export type ViewCause = "person" | "host" | "route" | "auto";

export type ConversationView<
  Conversation extends ConversationTarget = ConversationTarget,
> =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "opening";
      target: ConversationTarget;
      cause: ViewCause;
      /** What stays in view if opening fails. */
      previous: Conversation | null;
    }>
  | Readonly<{ kind: "open"; conversation: Conversation }>;

export type ViewState<
  Conversation extends ConversationTarget = ConversationTarget,
> = Readonly<{
  view: ConversationView<Conversation>;
  /** A Session being created, and why. Superseded when a choice is made. */
  creating: Readonly<{ ticket: number; cause: "person" | "auto" }> | null;
  /**
   * The route value the latest choice is still waiting to see echoed. A
   * target: the route is to become it. `null`: the route is to leave a
   * conversation. `undefined`: nothing outstanding.
   */
  awaitingRoute: ConversationTarget | null | undefined;
  /** The route as last observed, so a navigation to it is never requested. */
  route: ConversationTarget | null;
  nextTicket: number;
}>;

export type ViewEvent<
  Conversation extends ConversationTarget = ConversationTarget,
> =
  | Readonly<{
      type: "select";
      target: ConversationTarget;
      cause: "person" | "host";
    }>
  | Readonly<{ type: "route"; target: ConversationTarget | null }>
  /**
   * A navigation the view asked for has finished, and the router now shows
   * `target`. The router emits no route change when it was already there or
   * when a newer navigation replaced this one, so this settles the wait.
   */
  | Readonly<{ type: "route-confirmed"; target: ConversationTarget | null }>
  | Readonly<{ type: "create"; cause: "person" | "auto" }>
  | Readonly<{
      type: "created";
      ticket: number;
      target: ConversationTarget;
    }>
  | Readonly<{ type: "create-failed"; ticket: number }>
  | Readonly<{ type: "opened"; conversation: Conversation }>
  | Readonly<{ type: "open-failed" }>
  /** Leave the conversation: deleted, or a website took the pane. */
  | Readonly<{ type: "leave"; navigate: boolean }>
  /** The opener changed: nothing it opened is in view any more. */
  | Readonly<{ type: "reset" }>;

export type ViewEffect =
  | Readonly<{ type: "open"; target: ConversationTarget; fromHost: boolean }>
  | Readonly<{ type: "clear" }>
  | Readonly<{ type: "navigate"; target: ConversationTarget | null }>;

export type ViewTransition<
  Conversation extends ConversationTarget = ConversationTarget,
> = Readonly<{
  state: ViewState<Conversation>;
  effects: readonly ViewEffect[];
  /** For `create` and `created`: whether the event took effect. */
  accepted: boolean;
  /** For `create`: the ticket to report the Session's creation under. */
  ticket: number | null;
}>;

export const initialViewState: ViewState<never> = {
  view: { kind: "none" },
  creating: null,
  awaitingRoute: undefined,
  route: null,
  nextTicket: 1,
};

const same = (
  left: ConversationTarget | null | undefined,
  right: ConversationTarget | null | undefined,
): boolean =>
  left === right ||
  (!!left &&
    !!right &&
    left.agentId === right.agentId &&
    left.sessionId === right.sessionId);

/**
 * Make the route show `desired`. A navigation is asked for only when the route
 * is not already there, or when an earlier one is still outstanding and must be
 * overridden; the wait is set only when one is asked for.
 */
function follow(
  state: ViewState,
  desired: ConversationTarget | null,
): {
  awaitingRoute: ConversationTarget | null | undefined;
  effects: readonly ViewEffect[];
} {
  const needed =
    state.awaitingRoute !== undefined || !same(state.route, desired);
  return needed
    ? {
        awaitingRoute: desired,
        effects: [{ type: "navigate", target: desired }],
      }
    : { awaitingRoute: undefined, effects: [] };
}

/** The conversation the view shows or is opening, if any. */
function viewTarget(view: ConversationView): ConversationTarget | null {
  if (view.kind === "opening") return view.target;
  if (view.kind === "open") return view.conversation;
  return null;
}

function previousOf<Conversation extends ConversationTarget>(
  view: ConversationView<Conversation>,
): Conversation | null {
  return view.kind === "open"
    ? view.conversation
    : view.kind === "opening"
      ? view.previous
      : null;
}

function result<Conversation extends ConversationTarget>(
  state: ViewState<Conversation>,
  effects: readonly ViewEffect[] = [],
  accepted = true,
  ticket: number | null = null,
): ViewTransition<Conversation> {
  return { state, effects, accepted, ticket };
}

function choose<Conversation extends ConversationTarget>(
  state: ViewState<Conversation>,
  target: ConversationTarget,
  cause: ViewCause,
): ViewTransition<Conversation> {
  const shown = viewTarget(state.view);
  const fromHost = cause === "host";
  // Re-choosing what is already in view or opening changes nothing, but it
  // still voids a Session being created and makes the route mirror it.
  if (same(shown, target)) {
    const route = follow(state, target);
    return result(
      { ...state, creating: null, awaitingRoute: route.awaitingRoute },
      route.effects,
    );
  }
  // Returning to the conversation that is still open cancels the opening: the
  // opener drops its pending Session and keeps this one.
  const staying = previousOf(state.view);
  if (cause !== "route" && staying !== null && same(staying, target)) {
    const route = follow(state, target);
    return result(
      {
        ...state,
        view: { kind: "open", conversation: staying },
        creating: null,
        awaitingRoute: route.awaitingRoute,
      },
      [{ type: "open", target, fromHost }, ...route.effects],
    );
  }
  const route = cause === "route" ? null : follow(state, target);
  return result(
    {
      ...state,
      view: {
        kind: "opening",
        target,
        cause,
        previous: previousOf(state.view),
      },
      creating: null,
      awaitingRoute: route ? route.awaitingRoute : undefined,
    },
    [{ type: "open", target, fromHost }, ...(route ? route.effects : [])],
  );
}

/** The one transition function for the in-view conversation. */
export function transition<Conversation extends ConversationTarget>(
  state: ViewState<Conversation>,
  event: ViewEvent<Conversation>,
): ViewTransition<Conversation> {
  switch (event.type) {
    case "select":
      return choose(state, event.target, event.cause);

    case "route": {
      // Whatever it means, this is where the router is now.
      const observed = { ...state, route: event.target };
      const awaiting = observed.awaitingRoute;
      if (awaiting !== undefined) {
        // A choice's own echo is outstanding: it settles the wait; anything
        // else is the route as it was before that choice.
        return result(
          same(awaiting, event.target)
            ? { ...observed, awaitingRoute: undefined }
            : observed,
        );
      }
      if (event.target === null) {
        // Nothing to leave when nothing is in view, and a Session still being
        // created by a person is about to take the pane.
        if (
          observed.view.kind === "none" ||
          observed.creating?.cause === "person"
        )
          return result(observed);
        return result({ ...observed, view: { kind: "none" }, creating: null }, [
          { type: "clear" },
        ]);
      }
      if (same(viewTarget(observed.view), event.target))
        return result(observed);
      // Back/forward or a deep link, with no person's choice in flight.
      if (observed.creating?.cause === "person") return result(observed);
      return choose(observed, event.target, "route");
    }

    case "route-confirmed": {
      // The router finished a navigation the view asked for. It emits no route
      // change when it was already there or a newer navigation replaced this
      // one, so only the wait for what it now shows is over.
      const confirmed = { ...state, route: event.target };
      return result(
        same(confirmed.awaitingRoute, event.target)
          ? { ...confirmed, awaitingRoute: undefined }
          : confirmed,
      );
    }

    case "create": {
      if (event.cause === "auto") {
        const idle =
          state.view.kind === "none" &&
          state.creating === null &&
          state.awaitingRoute === undefined;
        if (!idle) return result(state, [], false);
      }
      const ticket = state.nextTicket;
      return result(
        {
          ...state,
          creating: { ticket, cause: event.cause },
          nextTicket: ticket + 1,
        },
        [],
        true,
        ticket,
      );
    }

    case "created": {
      // A Session whose request was superseded is simply not shown, and an
      // automatic one never displaces what is in view or opening.
      if (state.creating?.ticket !== event.ticket)
        return result(state, [], false);
      const cause = state.creating.cause;
      if (cause === "auto" && state.view.kind !== "none")
        return result({ ...state, creating: null }, [], false);
      return choose({ ...state, creating: null }, event.target, cause);
    }

    case "create-failed":
      return state.creating?.ticket === event.ticket
        ? result({ ...state, creating: null })
        : result(state, [], false);

    case "opened": {
      const view = state.view;
      if (view.kind !== "opening" || !same(view.target, event.conversation))
        return result(state, [], false);
      return result({
        ...state,
        view: { kind: "open", conversation: event.conversation },
      });
    }

    case "open-failed": {
      const view = state.view;
      if (view.kind !== "opening") return result(state, [], false);
      // Back to what was open, with the route following it: only if the route
      // has actually left it (or an earlier navigation is still outstanding).
      const back = view.previous;
      const route = follow(state, back);
      return result(
        {
          ...state,
          view: back ? { kind: "open", conversation: back } : { kind: "none" },
          awaitingRoute: route.awaitingRoute,
        },
        route.effects,
      );
    }

    case "leave": {
      const route = event.navigate ? follow(state, null) : null;
      return result(
        {
          ...state,
          view: { kind: "none" },
          creating: null,
          awaitingRoute: route ? route.awaitingRoute : undefined,
        },
        [{ type: "clear" }, ...(route ? route.effects : [])],
      );
    }

    case "reset":
      return result({
        ...state,
        view: { kind: "none" },
        creating: null,
        awaitingRoute: undefined,
      });
  }
}

/** The conversation the view shows: the open one, or the one being left. */
export function shownConversation<Conversation extends ConversationTarget>(
  state: ViewState<Conversation>,
): Conversation | null {
  return previousOf(state.view);
}

/** The conversation being opened, if one is. */
export function openingTarget(state: ViewState): ConversationTarget | null {
  return state.view.kind === "opening" ? state.view.target : null;
}

/** What a host reads from the view, replaced as a whole on every change. */
export type ConversationViewSnapshot<
  Session extends ParakeetSession = ShiitakeSession,
> = Readonly<{
  state: ViewState<OpenConversation<Session>>;
  /** Why the last opening failed, until the next one starts. */
  error: string | null;
}>;

export type ConversationViewOptions<
  Session extends ParakeetSession = ShiitakeSession,
> = Readonly<{
  connection: Pick<AppRoot, "capabilities"> & {
    ui: Pick<AppRoot["ui"], "reportAgentSessionSelection">;
  };
  queryClient: QueryClient;
  services: OpeningServices<Session>;
  /**
   * Mirror the view into a route. Resolves when the navigation has finished,
   * whether or not the router changed anything.
   */
  navigate?: ((target: ConversationTarget | null) => Promise<void>) | undefined;
  /** The route the router shows now; read once a navigation has finished. */
  shownRoute?: (() => ConversationTarget | null) | undefined;
}>;

/**
 * The one owner of "which conversation is in view" and of opening it: the
 * reducer above, the opener that reads and watches a Session, and the route
 * mirror. A host dispatches intents and reads {@link snapshot}; it keeps no
 * selection of its own.
 */
export function createConversationView<
  Session extends ParakeetSession = ShiitakeSession,
>(options: ConversationViewOptions<Session>) {
  type Conversation = OpenConversation<Session>;
  let snapshot: ConversationViewSnapshot<Session> = {
    state: initialViewState,
    error: null,
  };
  let closed = false;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<ConversationViewSnapshot<Session>>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };

  const opener = createConversationOpeningOwner<Session>({
    connection: options.connection,
    queryClient: options.queryClient,
    services: options.services,
    onPending: () => undefined,
    onConversation: (conversation) => {
      if (conversation !== null) dispatch({ type: "opened", conversation });
    },
    onError: (message) => {
      publish({ error: message });
      if (message !== null) dispatch({ type: "open-failed" });
    },
  });

  const run = (effect: ViewEffect) => {
    if (effect.type === "open")
      opener.select(
        effect.target.agentId,
        effect.target.sessionId,
        effect.fromHost,
      );
    else if (effect.type === "clear") opener.clear();
    else if (options.navigate !== undefined) {
      // The router emits no route change when it was already there or a newer
      // navigation replaced this one, so its settling is reported either way.
      const settled = () => {
        dispatch({
          type: "route-confirmed",
          target: options.shownRoute?.() ?? null,
        });
      };
      void options.navigate(effect.target).then(settled, settled);
    }
  };

  function dispatch(event: ViewEvent<Conversation>) {
    if (closed) return { accepted: false, ticket: null };
    const next = transition(snapshot.state, event);
    publish({ state: next.state });
    for (const effect of next.effects) run(effect);
    return { accepted: next.accepted, ticket: next.ticket };
  }

  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A person or the host chose a conversation. */
    select: (target: ConversationTarget, cause: "person" | "host" = "person") =>
      dispatch({ type: "select", target, cause }),
    /** The router now shows `target`, or the list when null. */
    observeRoute: (target: ConversationTarget | null) =>
      dispatch({ type: "route", target }),
    /** A Session is about to be created; report it under the ticket returned. */
    create: (cause: "person" | "auto" = "person") =>
      dispatch({ type: "create", cause }),
    created: (ticket: number, target: ConversationTarget) =>
      dispatch({ type: "created", ticket, target }),
    createFailed: (ticket: number) =>
      dispatch({ type: "create-failed", ticket }),
    /** Leave the conversation (deleted, or something else took the pane). */
    leave: (navigate: boolean) => dispatch({ type: "leave", navigate }),
    close: () => {
      if (closed) return;
      dispatch({ type: "reset" });
      closed = true;
      opener.close();
      listeners.clear();
    },
  };
}

export type ConversationViewOwner = ReturnType<typeof createConversationView>;
