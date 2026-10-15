import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataRow,
  DataListHeading,
} from "@fungi.computer/caps/components/data-list";
import { Status } from "@fungi.computer/caps/components/status";
import type { ClientContributionV1 } from "@fungi.computer/shiitake/client-entry";
import { useSyncExternalStore } from "react";
import { useParakeetInteractions } from "../conversation.js";
import type { RowV1 } from "@fungi.computer/gills";
import type { useClientActions } from "../client-contributions.js";

export type ClientRowsProps = Readonly<{
  entryId: string;
  rows: ClientContributionV1["panel"];
  actions: ReturnType<typeof useClientActions>;
  onOpen?: ((target: NonNullable<RowV1["open"]>) => void) | undefined;
}>;

const rowColors = {
  attention: "text-warning",
  running: "text-info",
  error: "text-error",
  settled: "text-success",
  muted: "text-dim",
} as const;

/** Render admitted data; commands and request state remain in Parakeet headless. */
export function ClientRows({
  entryId,
  rows,
  actions,
  onOpen,
}: ClientRowsProps) {
  const store = useParakeetInteractions();
  const { inspection } = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  if (rows.length === 0) return null;
  return (
    <div className="px-3 text-xs text-base-content" data-client-entry={entryId}>
      {rows.map((row) => (
        <div key={row.id} data-client-row={row.id} className="py-1">
          <div className="flex items-start gap-2">
            <details className="min-w-0 flex-1">
              <summary
                className={`cursor-pointer break-words leading-4 ${row.tone === undefined ? "" : rowColors[row.tone]}`}
              >
                {row.title}
                {row.inspection === undefined || row.detail === undefined
                  ? null
                  : ` · ${row.detail}`}
              </summary>
              {row.detail === undefined ? null : (
                <p className="max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words pb-2">
                  {row.detail}
                </p>
              )}
            </details>
            {row.open === undefined ? null : (
              <Button
                size="xs"
                variant="outline"
                disabled={onOpen === undefined}
                onClick={() => {
                  if (row.open !== undefined) onOpen?.(row.open);
                }}
              >
                Open
              </Button>
            )}
            {row.actions?.map((action) => {
              const state = actions.state.get(action);
              return (
                <Button
                  key={action.id}
                  size="xs"
                  variant="outline"
                  className="shrink-0"
                  disabled={!actions.enabled || state?.pending === true}
                  loading={state?.pending === true}
                  onClick={() => {
                    void actions.execute(entryId, action);
                  }}
                >
                  {action.label}
                </Button>
              );
            })}
          </div>
          {row.inspection !== undefined &&
          inspection?.entryId === entryId &&
          inspection.rowId === row.id ? (
            <section aria-label={row.title} data-client-inspection={row.id}>
              <DataListHeading
                aside={
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      store.inspect(undefined);
                    }}
                  >
                    Close
                  </Button>
                }
              >
                {row.title}
              </DataListHeading>
              <DataList
                density="compact"
                tabIndex={0}
                className="max-h-64 overflow-y-auto overscroll-contain"
              >
                {row.inspection.rows.map((child) => (
                  <DataRow key={child.id}>
                    <Status
                      glyph="dot"
                      size="compact"
                      tone={
                        child.tone === "settled"
                          ? "success"
                          : child.tone === "running"
                            ? "info"
                            : child.tone === "error"
                              ? "error"
                              : child.tone === "attention"
                                ? "warning"
                                : "neutral"
                      }
                      label={child.title}
                    />
                    {child.detail === undefined ? null : (
                      <span>{child.detail}</span>
                    )}
                  </DataRow>
                ))}
              </DataList>
            </section>
          ) : null}
          {row.actions?.map((action) => {
            const error = actions.state.get(action)?.error;
            return error === undefined ? null : (
              <p key={action.id} className="text-error" role="alert">
                {error}
              </p>
            );
          })}
        </div>
      ))}
    </div>
  );
}
