import type { AvatarSpriteProps } from "./avatar-presentation.js";

const MAX_ENTRIES = 128;

/**
 * Idle heads shown over and over (an Agent rail) do not need their own live
 * canvas: once one instance of a descriptor has rendered, every other idle
 * instance can show the same still frame. Keyed by the resolved presentation
 * plus the pixel size it was drawn at, so a resize or a different size
 * elsewhere never serves the wrong frame. An LRU of about 128 entries; the
 * oldest is evicted once that is exceeded.
 */
const cache = new Map<string, string>();

/** The still-frame cache key for one presentation at one pixel size. */
export function stillFrameKey(
  presentation: AvatarSpriteProps,
  size: number,
  devicePixelRatio: number,
): string {
  return JSON.stringify([
    presentation.src,
    presentation.appearance,
    presentation.expression,
    presentation.renderStyle,
    size,
    devicePixelRatio,
  ]);
}

/** The cached still frame for `key`, refreshing its recency, or `undefined`. */
export function getStillFrame(key: string): string | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

/** Cache `value` (a data URL) for `key`, evicting the oldest entry past 128. */
export function setStillFrame(key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

/**
 * Capture the idle frame of a just-rendered Sprite host as a still image, or
 * `undefined` when the host has no live canvas yet (not ready) or the
 * canvas export is denied because the canvas is tainted. Other export failures
 * propagate with their cause.
 */
export function captureStillFrame(
  host: HTMLElement | null,
): string | undefined {
  const canvas = host?.querySelector("canvas");
  if (!canvas) return undefined;
  try {
    return canvas.toDataURL("image/png");
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "SecurityError")
      return undefined;
    throw new Error("Could not capture an avatar still frame", { cause });
  }
}

/** Test-only: clears every cached still frame so tests do not leak between runs. */
export function clearStillFrameCache(): void {
  cache.clear();
}
