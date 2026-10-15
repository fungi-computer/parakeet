import type { SessionMessage } from "@fungi.computer/shiitake/client";

/** Who wrote a timeline line, as the host chose to show them. */
export type ParakeetAuthor = Readonly<{
  /** A stable identity that tells two same-named authors apart. */
  id: string;
  /** The name shown beside the line. */
  name: string;
}>;

/**
 * The host's reading of a message's opaque metadata: the author to show, or
 * none. Parakeet never interprets metadata itself.
 */
export type ParakeetAuthorOf = (
  meta: SessionMessage["meta"],
) => ParakeetAuthor | undefined;

/** The default reading: metadata names no author Parakeet can show. */
export const noAuthor: ParakeetAuthorOf = () => undefined;

export function authorDisplayNames(
  authors: readonly ParakeetAuthor[],
): ReadonlyMap<string, string> {
  const identities = new Map<string, Set<string>>();
  for (const { id, name } of authors) {
    const known = identities.get(name) ?? new Set<string>();
    known.add(id);
    identities.set(name, known);
  }
  return new Map(
    authors.map(({ id, name }) => [
      id,
      (identities.get(name)?.size ?? 0) > 1
        ? `${name} · ${id.slice(-6)}`
        : name,
    ]),
  );
}
