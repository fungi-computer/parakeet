import type { ReactNode } from "react";

import { ShiitakeAvatar } from "./ShiitakeAvatar.js";

/**
 * A boot wait that failed, in the curtain's own centered layout: the mascot
 * looking concerned, one plain line naming the real cause, a short reference
 * when the failure carries one, and the host's actions (a compact Reload).
 * It replaces the curtain, so a failure is never left underneath it.
 */
export function BootFailure({
  children,
  message,
  note,
  reference,
}: {
  /** The recovery actions, such as a Caps Button that reloads. */
  children?: ReactNode;
  /** One plain sentence naming the real cause. */
  message: string;
  /** A second plain line, such as why a recovery attempt also failed. */
  note?: string | undefined;
  /** A short request id or code the person can quote. */
  reference?: string | undefined;
}) {
  return (
    <div className="boot-curtain" data-boot-failure="" role="alert">
      <span className="boot-curtain-stage">
        <ShiitakeAvatar
          className="boot-curtain-face"
          state={{ activity: "idle", expression: "sad" }}
        />
      </span>
      <p className="boot-curtain-copy">{message}</p>
      {note ? <p className="boot-curtain-copy">{note}</p> : null}
      {reference ? (
        <p className="boot-curtain-copy text-sm opacity-70">Ref {reference}</p>
      ) : null}
      {children ? (
        <div className="flex flex-wrap justify-center gap-sm">{children}</div>
      ) : null}
    </div>
  );
}
