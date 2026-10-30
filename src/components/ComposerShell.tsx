import {
  useLayoutEffect,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { Card } from "@fungi.computer/caps/components/card";
import { Composer } from "@fungi.computer/caps/blocks/composer";
import { PopoverAnchor } from "@fungi.computer/caps/components/popover";
import {
  StatusTray,
  type StatusTrayItem,
} from "@fungi.computer/caps/blocks/status-tray";
import { cn } from "@fungi.computer/caps/lib/cn";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import type { SendActionState } from "@fungi.computer/caps/components/send-action";

/** One input-to-action rule for both Apps; Caps owns the resulting key's look. */
export function composerSendState({
  draft,
  hasAttachments = false,
  busy,
  queueWhileBusy = false,
  blocked = false,
}: {
  draft: string;
  hasAttachments?: boolean;
  busy: boolean;
  /** Chat can queue a follow-up; generation stays busy until it settles. */
  queueWhileBusy?: boolean;
  /** An input owner can temporarily block submission, such as during recall. */
  blocked?: boolean;
}): SendActionState {
  const hasInput = !blocked && (draft.trim().length > 0 || hasAttachments);
  if (busy && (!queueWhileBusy || !hasInput)) return "busy";
  return hasInput ? "ready" : "empty";
}

/** App-owned controls and tray contents; Parakeet owns their single row. */
export type ComposerShellRow = Readonly<{
  /** App-specific leading keys and status indicators. */
  controls: ReactNode;
  /** Send or Generate key, held at the row's right edge. */
  action: ReactNode;
  /** Persistent status beside usage and Send, never between leading keys. */
  status?: ReactNode;
  /** Quiet context summary; hidden when the shell is narrow. */
  readout?: ReactNode;
  /** Native tray keys and panels supplied by the App. */
  items: readonly StatusTrayItem[];
  /** Open tray item, or null when the tray is closed. */
  openId: string | null;
  /** Delegate tray selection to the caller's state owner. */
  onOpenChange: (id: string | null) => void;
}>;

/** Content slots for the shared chat and generation composer surface. */
export type ComposerShellProps = HTMLAttributes<HTMLDivElement> & {
  /** Draft field or decision surface, using the shared input geometry. */
  input: ReactNode;
  /** Optional draft attachments rendered by the Composer primitive. */
  attachments?: ReactNode;
  /** Retained field-and-Send mode without an internal control row. */
  action?: ReactNode;
  /** Optional completion menu anchored to this shell. */
  menu?: ReactNode;
  /** Omit while a decision owns the input and its own actions. */
  row?: ComposerShellRow | undefined;
};

/** One field surface and one non-wrapping control row, with Send at its end. */
export function ComposerShell({
  attachments,
  action,
  children,
  className,
  input,
  menu,
  row,
  ...props
}: ComposerShellProps) {
  return (
    <PopoverAnchor className="parakeet-composer-anchor">
      {menu}
      <Card {...props} className={cn("parakeet-composer-shell", className)}>
        <Composer
          action={action}
          attachments={attachments}
          input={input}
          toolbar={
            row === undefined ? undefined : (
              <StatusTray
                className="parakeet-composer-row"
                align="start"
                items={row.items}
                openId={row.openId}
                onOpenChange={row.onOpenChange}
                renderTrigger={({ children: label, ...trigger }) => (
                  <KeycapButton
                    {...trigger}
                    label={label}
                    expanded={trigger["aria-expanded"] === true}
                  />
                )}
                leading={row.controls}
                trailing={
                  <span className="parakeet-composer-trailing">
                    {row.status}
                    {row.readout == null ? null : (
                      <span className="parakeet-composer-readout">
                        {row.readout}
                      </span>
                    )}
                    <span className="parakeet-composer-action">
                      {row.action}
                    </span>
                  </span>
                }
              />
            )
          }
        />
        {children}
      </Card>
    </PopoverAnchor>
  );
}

/** Grow either App's field with its draft; shell CSS owns the height limits. */
export function useComposerTextareaSize(
  ref: RefObject<HTMLTextAreaElement>,
  value: string,
) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${String(field.scrollHeight)}px`;
  }, [ref, value]);
}
