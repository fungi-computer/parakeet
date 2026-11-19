import { useState } from "react";

import { bootCurtainFaceSvg } from "./boot-curtain-face.js";
import { ShiitakeAvatar } from "./ShiitakeAvatar.js";

/**
 * The one full-viewport wait a person sees between signing in and a ready
 * desktop. Every pre-ready state of that journey renders this component at
 * this fixed position, so the Hub's separate documents read as one loader.
 * It shows the Shiitake mascot thinking and one line of copy, never a
 * spinner; Sprite holds the face still under reduced motion, so the copy
 * alone carries the state. Until the live face is drawn, the same SVG face
 * the Hub's static first-frame markup carries stands in for it. Only a
 * state that cannot fail, or one that lifts the curtain on its own error,
 * may render it: the curtain sits above toasts.
 */
export function BootCurtain({ message }: { message: string }) {
  const [ready, setReady] = useState(false);
  return (
    <div
      className="boot-curtain"
      data-boot-curtain=""
      role="status"
      aria-live="polite"
    >
      <span className="boot-curtain-stage">
        {ready ? null : (
          <span
            className="boot-curtain-standin"
            dangerouslySetInnerHTML={{ __html: bootCurtainFaceSvg }}
          />
        )}
        <ShiitakeAvatar
          className="boot-curtain-face"
          onState={(state) => {
            setReady(state.status === "ready");
          }}
          state={{ activity: "thinking", expression: "normal" }}
        />
      </span>
      <p className="boot-curtain-copy">{message}</p>
    </div>
  );
}
