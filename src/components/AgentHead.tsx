import { Monogram } from "@fungi.computer/caps/components/monogram";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { Sprite } from "@fungi.computer/sprite/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { avatarPresentation } from "./avatar-presentation.js";
import { shiitakeSprite } from "./sprite-service.js";
import {
  captureStillFrame,
  getStillFrame,
  setStillFrame,
  stillFrameKey,
} from "./still-frame-cache.js";

/** What the head is doing: at rest, working something out, or talking. */
export type AgentHeadActivity = "idle" | "thinking" | "speaking";

/**
 * An Agent's head at avatar size. Renders the Agent's own avatar when given
 * one; otherwise the pre-avatar seeded mushroom cap, byte-identical to
 * before avatars existed. The letter shows until a frame is ready. It holds
 * still unless `thinking` or `speaking`: an idle head whose render style is
 * "plain" and already has a cached still frame for its look never mounts a
 * live canvas, so a long rail is not a wall of animation. A render style
 * other than "plain" is a CSS filter over the live canvas, not part of the
 * captured pixels, so a styled head always stays live.
 */
export const AgentHead = memo(function AgentHead({
  activity = "idle",
  avatar,
  className,
  name,
  seed,
  size = 24,
}: {
  /** Motion presented by the head; defaults to idle. */
  activity?: AgentHeadActivity;
  /** The Agent's stored avatar; omitted or `null` falls back to the seed. */
  avatar?: Avatar | null;
  /** Host classes applied to the head container. */
  className?: string;
  /** The name whose first letter stands in until a frame is ready. */
  name: string;
  /** Stable identity that picks the fallback cap colour. */
  seed: string;
  /** Width and height in pixels. */
  size?: number;
}) {
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const presentation = useMemo(
    () => avatarPresentation(avatar, seed),
    [avatar, seed],
  );
  const dpr = window.devicePixelRatio;
  const cacheKey = useMemo(
    () => stillFrameKey(presentation, size, dpr),
    [presentation, size, dpr],
  );
  const [frame, setFrame] = useState(() => getStillFrame(cacheKey));
  useEffect(() => {
    setFrame(getStillFrame(cacheKey));
  }, [cacheKey]);

  // A render style is a CSS filter on the live stage (render-style.ts), not
  // part of the captured canvas pixels, so a styled head must stay live;
  // only a "plain" idle head can be replaced by its cached still frame.
  const live =
    activity !== "idle" ||
    frame === undefined ||
    presentation.renderStyle !== "plain";
  useEffect(() => {
    // A cached idle head has no player; its next player must become ready anew.
    if (!live) setReady(false);
  }, [live]);

  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 ${className ?? ""}`}
      data-agent-head={frame !== undefined || ready ? "ready" : "loading"}
      style={{ height: size, width: size }}
    >
      {frame === undefined && !ready ? (
        <Monogram className="absolute inset-0" name={name} seed={seed} />
      ) : null}
      {frame !== undefined &&
      presentation.renderStyle === "plain" &&
      (!live || !ready) ? (
        <img alt="" className="absolute inset-0 h-full w-full" src={frame} />
      ) : null}
      {live ? (
        <Sprite
          activity={activity}
          appearance={presentation.appearance}
          className="absolute inset-0"
          expression={presentation.expression}
          onState={(state) => {
            setReady(state.status === "ready");
            if (
              state.status === "ready" &&
              activity === "idle" &&
              presentation.renderStyle === "plain"
            ) {
              const captured = captureStillFrame(host.current);
              if (captured !== undefined) {
                setStillFrame(cacheKey, captured);
                setFrame(captured);
              }
            }
          }}
          paused={activity === "idle"}
          ref={host}
          renderStyle={presentation.renderStyle}
          service={shiitakeSprite}
          src={presentation.src}
        />
      ) : null}
    </span>
  );
});
