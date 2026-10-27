const pad = (value: number) => String(value).padStart(2, "0");

const dayStart = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When something happened, as a picker column: `14:02` for today, `Yesterday`,
 * or `2026-10-24`. Shared by every picker that lists past work.
 */
export function formatWhen(epochMillis: number, now: number): string {
  const at = new Date(epochMillis);
  const days = Math.round(
    (dayStart(new Date(now)) - dayStart(at)) / 86_400_000,
  );
  if (days <= 0) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (days === 1) return "Yesterday";
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `text` on one line, whitespace collapsed and cut at a word to `limit`. */
export function oneLine(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  if (line.length <= limit) return line;
  const cut = line.slice(0, Math.max(0, limit - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
