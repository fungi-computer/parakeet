import { Monogram } from "@fungi.computer/caps/components/monogram";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { Sprite } from "@fungi.computer/sprite/react";
import { memo, useMemo, useState } from "react";

import { avatarPresentation } from "./avatar-presentation.js";
import { shiitakeSprite } from "./sprite-service.js";

/** What the head is doing: at rest, working something out, or talking. */
export type AgentHeadActivity = "idle" | "thinking" | "speaking";

/**
 * An Agent's head at avatar size, drawn from the Agent's own avatar (a
 * property of the Agent record, never of a conversation). The letter shows
 * until a frame is ready. The live
 * canvas stays mounted and is paused unless `thinking` or `speaking`, so an
 * idle head shows its real look without animating.
 */
export const AgentHead = memo(function AgentHead({
  activity = "idle",
  avatar,
  className,
  name,
  size = 24,
}: {
  /** Motion presented by the head; defaults to idle. */
  activity?: AgentHeadActivity;
  /** The Agent's avatar, from its Agent record. */
  avatar: Avatar;
  /** Host classes applied to the head container. */
  className?: string;
  /** The name whose first letter stands in until a frame is ready. */
  name: string;
  /** Width and height in pixels. */
  size?: number;
}) {
  const [ready, setReady] = useState(false);
  const presentation = useMemo(() => avatarPresentation(avatar), [avatar]);
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 ${className ?? ""}`}
      data-agent-head={ready ? "ready" : "loading"}
      style={{ height: size, width: size }}
    >
      {ready ? null : (
        <Monogram className="absolute inset-0" name={name} seed={name} />
      )}
      <Sprite
        activity={activity}
        appearance={presentation.appearance}
        className="absolute inset-0"
        expression={presentation.expression}
        onState={(state) => {
          setReady(state.status === "ready");
        }}
        paused={activity === "idle"}
        renderStyle={presentation.renderStyle}
        service={shiitakeSprite}
        src={presentation.src}
      />
    </span>
  );
});
