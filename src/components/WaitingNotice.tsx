import {
  queuedSessionLabel,
  type SessionViewState,
} from "../core/session-view-state.js";

/** A queued Session reports the executor fact; stopping a turn leaves its queue intact. */
export function WaitingNotice({
  waiting,
}: Readonly<{
  waiting: Extract<SessionViewState, { kind: "queued" }> | null;
}>) {
  if (waiting === null) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-dim"
      data-parakeet-waiting="waiting"
    >
      <span>{queuedSessionLabel(waiting)}</span>
    </div>
  );
}
