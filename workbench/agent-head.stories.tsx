import type { StoryDefault } from "@ladle/react";
import { Sprite } from "@fungi.computer/sprite/react";
import type { Avatar } from "@fungi.computer/sprite/avatar";
import { deriveAgentAvatar } from "@fungi.computer/sprite-zdog/avatar";

import { agentAppearance, seededAvatar } from "@fungi.computer/sprite/avatar";
import { AgentHead } from "../src/components/AgentHead.js";
import { shiitakeSprite } from "../src/components/sprite-service.js";
import "@fungi.computer/parakeet/styles.css";

export default { title: "Parakeet / Agent heads" } satisfies StoryDefault;

const legacySeeds = [
  "agent-gardener",
  "agent-librarian",
  "agent-maker",
  "agent-scribe",
  "agent-sprout",
  "agent-moss",
];

/**
 * The exact Sprite call the original `AgentHead` made, before avatars
 * existed: a hardcoded mushroom, `agentAppearance(seed)`, expression
 * "normal", no render style. Kept here, byte for byte, as the pixel
 * reference the browser proof compares the new fallback against.
 */
function LegacyReference({ seed, size = 48 }: { seed: string; size?: number }) {
  return (
    <div
      data-testid={`legacy-${seed}`}
      style={{ height: size, width: size, position: "relative" }}
    >
      <Sprite
        activity="idle"
        appearance={agentAppearance(seed)}
        expression="normal"
        paused
        service={shiitakeSprite}
        src={{ local: "mushroom" }}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}

/** Pairs the old literal Sprite call against `AgentHead` wearing `seededAvatar`. */
export const FallbackComparison = () => (
  <div className="flex flex-col gap-md p-md" data-testid="fallback-comparison">
    {legacySeeds.map((seed) => (
      <div key={seed} className="flex items-center gap-md">
        <LegacyReference seed={seed} size={48} />
        <div
          data-testid={`new-${seed}`}
          style={{ height: 48, width: 48, position: "relative" }}
        >
          <AgentHead name={seed} avatar={seededAvatar(seed)} size={48} />
        </div>
        <span>{seed}</span>
      </div>
    ))}
  </div>
);

const liveActivityByIndex = new Map<number, "thinking" | "speaking">([
  [3, "thinking"],
  [37, "speaking"],
]);

/** 50 heads, almost all idle: paused live canvases keep a long rail cheap. */
export const FiftyHeads = () => (
  <div className="grid grid-cols-10 gap-sm p-md" data-testid="fifty-heads">
    {Array.from({ length: 50 }, (_, index) => (
      <AgentHead
        key={index}
        activity={liveActivityByIndex.get(index) ?? "idle"}
        name={`Agent ${String(index)}`}
        avatar={seededAvatar(`agent-fifty-${String(index)}`)}
        size={32}
      />
    ))}
  </div>
);

const member = (
  character: Avatar["character"],
  appearance: Avatar["appearance"],
): Avatar => ({
  v: 1,
  character,
  appearance,
  expression: "normal",
  renderStyle: "plain",
});

const launchMembers: readonly Avatar[] = [
  member("mushroom", { cap: "#f98284", capSpot: "#ffe6c6" }),
  member("cat", { body: "#ffe6c6", stripes: "#dea38b" }),
  member("burger", { topBun: "#f4a261", bottomBun: "#e9c46a" }),
];

const styledAvatar: Avatar = {
  v: 1,
  character: "mushroom",
  appearance: { cap: "#f98284", capSpot: "#ffe6c6" },
  expression: "normal",
  renderStyle: "manga",
};

/**
 * A "manga" idle head, shown twice: the live canvas must never drop
 * the render style, since it is a live CSS filter over the canvas.
 */
export const StyledHead = () => (
  <div className="flex items-center gap-lg p-md" data-testid="styled-head">
    <div
      data-testid="styled-first"
      style={{ height: 64, width: 64, position: "relative" }}
    >
      <AgentHead avatar={styledAvatar} name="Styled" size={64} />
    </div>
    <div
      data-testid="styled-second"
      style={{ height: 64, width: 64, position: "relative" }}
    >
      <AgentHead avatar={styledAvatar} name="Styled" size={64} />
    </div>
    <span>manga, idle, twice: both must keep the filter</span>
  </div>
);

/**
 * Descriptor-driven heads for the three launch characters, each shown as the
 * member's own avatar plus the Agent look derived from it with colour swap
 * on (`shift`) and off (`keep`).
 */
export const Descriptors = () => (
  <div className="flex flex-col gap-lg p-md" data-testid="descriptors">
    {launchMembers.map((avatar) => {
      const shifted = deriveAgentAvatar(
        avatar,
        "shift",
        `${avatar.character}-agent`,
      );
      const kept = deriveAgentAvatar(
        avatar,
        "keep",
        `${avatar.character}-agent`,
      );
      return (
        <div key={avatar.character} className="flex items-center gap-lg">
          <div
            data-testid={`member-${avatar.character}`}
            style={{ height: 64, width: 64, position: "relative" }}
          >
            <AgentHead avatar={avatar} name={avatar.character} size={64} />
          </div>
          <div
            data-testid={`shift-${avatar.character}`}
            style={{ height: 64, width: 64, position: "relative" }}
          >
            <AgentHead avatar={shifted} name={avatar.character} size={64} />
          </div>
          <div
            data-testid={`keep-${avatar.character}`}
            style={{ height: 64, width: 64, position: "relative" }}
          >
            <AgentHead avatar={kept} name={avatar.character} size={64} />
          </div>
          <span>
            {avatar.character}: member, colour swap on, colour swap off
          </span>
        </div>
      );
    })}
  </div>
);
