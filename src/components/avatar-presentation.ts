import { legacyAvatar, type Avatar } from "@fungi.computer/sprite/avatar";
import type { AvatarPresentation as SpriteAvatarPresentation } from "@fungi.computer/sprite";

/**
 * Sprite props for one avatar, independent of the live `activity` a composer
 * drives moment to moment. Every avatar-aware Parakeet component builds its
 * `<Sprite>` props through this one mapper, so a stored avatar and the
 * pre-avatar seeded look reach the canvas the same way. Unlike the Sprite
 * service's own `AvatarPresentation`, these are never optional: the mapper
 * always resolves a complete avatar, stored or legacy.
 */
export type AvatarSpriteProps = {
  readonly src: SpriteAvatarPresentation["src"];
  readonly appearance: NonNullable<SpriteAvatarPresentation["appearance"]>;
  readonly expression: NonNullable<SpriteAvatarPresentation["expression"]>;
  readonly renderStyle: NonNullable<SpriteAvatarPresentation["renderStyle"]>;
};

/**
 * Map a stored avatar (or `null`/`undefined`, meaning none is saved yet) to
 * Sprite props. The fallback is `legacyAvatar(seed)`: the mushroom, in the
 * same seeded cap colour Agents have always worn, so an existing Agent
 * renders byte-identically to before avatars existed.
 */
export function avatarPresentation(
  avatar: Avatar | null | undefined,
  seed: string,
): AvatarSpriteProps {
  const resolved = avatar ?? legacyAvatar(seed);
  return {
    src: { local: resolved.character },
    appearance: resolved.appearance,
    expression: resolved.expression,
    renderStyle: resolved.renderStyle,
  };
}
