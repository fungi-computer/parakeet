import type { Avatar } from "@fungi.computer/sprite/avatar";
import {
  type AvatarPresentation,
  type SpriteService,
} from "@fungi.computer/sprite";
import { Sprite } from "@fungi.computer/sprite/react";
import { memo, useMemo } from "react";

import { avatarPresentation } from "./avatar-presentation.js";
import { shiitakeSprite } from "./sprite-service.js";

/** The current activity and expression supplied to a live avatar. */
export type AvatarState = Readonly<
  Pick<AvatarPresentation, "activity" | "expression">
>;

/**
 * A sprite head drawn in the live activity and expression it is given. With
 * an `avatar` it draws that look (a member's own, in their settings); with
 * none it is Shiitake, the product mascot, in the character's own defaults.
 * Conversations have no avatar: an Agent's head is `AgentHead`, drawn from
 * the Agent record.
 */
export const ShiitakeAvatar = memo(function ShiitakeAvatar({
  avatar,
  className = "h-12 w-12 shrink-0",
  service = shiitakeSprite,
  state,
}: {
  /** The look to draw; omitted or `null` draws the mascot. */
  avatar?: Avatar | null;
  /** Replaces the default 3rem size, for a host that sizes the head itself. */
  className?: string;
  /** Replaces the shared Shiitake service; a faithful fake for tests. */
  service?: SpriteService;
  /** Activity and expression presented by the avatar. */
  state: AvatarState;
}) {
  const presentation = useMemo(
    () => (avatar ? avatarPresentation(avatar) : undefined),
    [avatar],
  );
  return (
    <Sprite
      aria-hidden="true"
      className={className}
      service={service}
      src={presentation?.src ?? { local: "mushroom" }}
      {...(presentation
        ? {
            appearance: presentation.appearance,
            renderStyle: presentation.renderStyle,
          }
        : {})}
      {...state}
    />
  );
});
