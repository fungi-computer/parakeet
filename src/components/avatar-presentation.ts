import type { Avatar } from "@fungi.computer/sprite/avatar";
import type { AvatarPresentation as SpriteAvatarPresentation } from "@fungi.computer/sprite";

/**
 * Sprite props for one Agent's avatar, independent of the live `activity` a
 * host drives moment to moment. Unlike the Sprite service's own
 * `AvatarPresentation`, these are never optional: every Agent record carries
 * a complete avatar.
 */
export type AvatarSpriteProps = {
  readonly src: SpriteAvatarPresentation["src"];
  readonly appearance: NonNullable<SpriteAvatarPresentation["appearance"]>;
  readonly expression: NonNullable<SpriteAvatarPresentation["expression"]>;
  readonly renderStyle: NonNullable<SpriteAvatarPresentation["renderStyle"]>;
};

/** Map an Agent's avatar to Sprite props. */
export function avatarPresentation(avatar: Avatar): AvatarSpriteProps {
  return {
    src: { local: avatar.character },
    appearance: avatar.appearance,
    expression: avatar.expression,
    renderStyle: avatar.renderStyle,
  };
}
