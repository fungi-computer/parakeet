import type { SessionContext } from "@fungi.computer/shiitake/client";

/**
 * One token count, compacted for a narrow readout, e.g. `182000` to `182K`.
 * Shared by the context footer and the compaction divider and notices.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${String(Math.round(tokens / 1_000))}K`;
  return `${String(Math.round(tokens / 100_000) / 10)}M`;
}

/**
 * Context used over the model's window, e.g. `12K/200K`, shared by the
 * browser and terminal footers. An unknown window shows the tokens alone.
 */
export function formatContextUsage(context: SessionContext): string {
  return context.window === null
    ? formatTokenCount(context.tokens)
    : `${formatTokenCount(context.tokens)}/${formatTokenCount(context.window)}`;
}
