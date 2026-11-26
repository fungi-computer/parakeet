import { useEffect, useRef } from "react";

import { returnsAgentRename } from "./core/agent-rename-result.js";
import type { TimelineItem } from "./store/types.js";

/**
 * Tell the host when the Agent renames itself while this conversation is open,
 * so a header or list that copied the name can refresh now instead of on the
 * next load. Renames already in the history are not news.
 */
export function useAgentRenamed(
  items: readonly TimelineItem[],
  onAgentRenamed: (() => void) | undefined,
) {
  const seen = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    const renames = items.flatMap((item) =>
      item.kind === "tool_group" ? item.tools.filter(returnsAgentRename) : [],
    );
    const known = seen.current;
    seen.current = new Set(renames.map((tool) => tool.id));
    if (known !== undefined && renames.some((tool) => !known.has(tool.id)))
      onAgentRenamed?.();
  }, [items, onAgentRenamed]);
}
