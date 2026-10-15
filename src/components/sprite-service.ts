import { createSprite } from "@fungi.computer/sprite";

/** The one Sprite service Parakeet's mascot components share. */
export const shiitakeSprite = createSprite({
  characters: {
    mushroom: async () =>
      (await import("@fungi.computer/sprite-zdog/mushroom")).default,
    cat: async () => (await import("@fungi.computer/sprite-zdog/cat")).default,
    burger: async () =>
      (await import("@fungi.computer/sprite-zdog/burger")).default,
  },
});
