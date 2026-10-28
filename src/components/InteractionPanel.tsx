import { Alert } from "@fungi.computer/caps/components/alert";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Disclosure } from "@fungi.computer/caps/components/disclosure";
import { Field } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Listbox } from "@fungi.computer/caps/components/listbox";
import { Status } from "@fungi.computer/caps/components/status";
import { Display } from "@fungi.computer/caps/components/surface";
import type {
  WhistleInteractionHost,
  WhistlePendingPrompt,
} from "@fungi.computer/whistle/interaction";
import type { WhistlePromptOption } from "@fungi.computer/whistle";
import {
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

/** The interaction to draw and the page's close callback. */
export type InteractionPanelProps = Readonly<{
  /** The renderer-neutral interaction store. */
  host: WhistleInteractionHost;
  /** Close a settled interaction. */
  onClose?: () => void;
}>;

/** The text every prompt carries above its choices. */
export type PromptContent = Pick<
  WhistlePendingPrompt["request"],
  "message" | "summary" | "facts" | "body" | "bodyLabel" | "details"
>;

/** Summary, facts, long text and on-demand details: the shared modal anatomy. */
export function PromptHeader({
  request,
  trailing,
}: Readonly<{
  request: PromptContent;
  /** Drawn at the end of the title line, e.g. a `1 of 3` marker. */
  trailing?: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const entries = (list: PromptContent["facts"]) =>
    list === undefined ? null : (
      <DataList density="compact">
        {list.map((entry) => (
          // Facts read as one block of label/value lines, with no rules between.
          <DataRow key={entry.label} className="after:hidden">
            <span className="text-sm opacity-70">{entry.label}</span>{" "}
            <span className="break-words">{entry.value}</span>
          </DataRow>
        ))}
      </DataList>
    );
  return (
    <>
      {trailing === undefined ? (
        <p className="font-medium">{request.message}</p>
      ) : (
        <div className="flex items-baseline justify-between gap-sm">
          <p className="font-medium">{request.message}</p>
          {trailing}
        </div>
      )}
      {request.summary === undefined ? null : (
        <p className="text-sm opacity-70">{request.summary}</p>
      )}
      {entries(request.facts)}
      {request.body === undefined ? null : (
        <p className="line-clamp-3 whitespace-pre-line break-words">
          {request.bodyLabel === undefined ? null : (
            <span className="text-sm opacity-70">{request.bodyLabel} </span>
          )}
          {request.body}
        </p>
      )}
      {request.details === undefined && request.body === undefined ? null : (
        <Disclosure open={open} onOpenChange={setOpen} summary="Details">
          {request.body === undefined ? null : (
            <p className="whitespace-pre-line break-words">{request.body}</p>
          )}
          {entries(request.details)}
        </Disclosure>
      )}
    </>
  );
}

function PromptView({
  host,
  pending,
}: Readonly<{ host: WhistleInteractionHost; pending: WhistlePendingPrompt }>) {
  const [text, setText] = useState("");
  const request = pending.request;
  if (request.type === "choice")
    return (
      <div className="flex flex-col gap-xs">
        <PromptHeader request={request} />
        <Listbox<WhistlePromptOption>
          aria-label={request.message}
          items={request.options}
          getKey={(option) => option.value}
          getLabel={(option) => option.label}
          onValueChange={(value) => {
            if (value !== null) host.answer(pending.sequence, value);
          }}
          renderItem={(option) => (
            <span
              className={`flex flex-col${option.destructive === true ? " text-error" : ""}`}
            >
              <span>
                {option.value === request.current ? "● " : ""}
                {option.label}
              </span>
              {option.description === undefined ? null : (
                <span className="text-sm opacity-70">{option.description}</span>
              )}
            </span>
          )}
        />
      </div>
    );
  if (request.type === "confirmation")
    return (
      <div className="flex flex-col gap-sm">
        <PromptHeader request={request} />
        <div className="flex justify-end gap-xs">
          <Button
            // A destructive question focuses the safe answer, which comes first.
            autoFocus={request.destructive === true}
            variant="ghost"
            onClick={() => host.answer(pending.sequence, false)}
          >
            {request.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={request.destructive === true ? "destructive" : "primary"}
            onClick={() => host.answer(pending.sequence, true)}
          >
            {request.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    );
  // A decision is answered in the composer; no dialog ever receives one.
  if (request.type === "decision") return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    host.answer(pending.sequence, text);
  };
  return (
    <form className="flex flex-col gap-sm" onSubmit={submit}>
      {request.summary === undefined &&
      request.facts === undefined &&
      request.body === undefined ? null : (
        <PromptHeader request={request} />
      )}
      <Field label={request.message}>
        <Input
          autoComplete="off"
          autoFocus
          placeholder={request.placeholder}
          type={request.secret === true ? "password" : "text"}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}

/**
 * Browser renderer for one Whistle interaction. It draws the same host
 * snapshot the terminal draws; the command, not the page, defines the steps.
 */
export function InteractionPanel({ host, onClose }: InteractionPanelProps) {
  const state = useSyncExternalStore(host.subscribe, host.snapshot);
  const active = state.status === "working" || state.status === "prompting";
  return (
    <section
      aria-label={state.title}
      className="flex flex-col gap-sm"
      data-status={state.status}
    >
      <h2 className="text-lg font-semibold">{state.title}</h2>
      {state.handoff === undefined ? null : (
        <Display density="compact">
          <div className="flex flex-col gap-xs p-sm">
            <span className="text-sm">
              {state.handoff.message ??
                (state.handoff.code === undefined
                  ? "Continue in your browser"
                  : "Open this page and enter the code")}
            </span>
            <a
              className="link break-all font-mono"
              href={state.handoff.url}
              rel="noreferrer"
              target="_blank"
            >
              {state.handoff.url}
            </a>
            {state.handoff.code === undefined ? null : (
              <span className="font-mono text-2xl tracking-widest">
                {state.handoff.code}
              </span>
            )}
          </div>
        </Display>
      )}
      {state.message === undefined || state.status === "failed" ? null : (
        <p className="flex items-center gap-xs">
          <Status
            tone={state.message.type === "success" ? "success" : "info"}
            motion={
              state.message.type === "progress" && active ? "pulse" : "none"
            }
          />
          {state.message.message}
        </p>
      )}
      {state.links.map((link) => (
        <a
          key={link.url}
          className="link break-all"
          href={link.url}
          rel="noreferrer"
          target="_blank"
        >
          {link.label ?? link.url}
        </a>
      ))}
      {state.prompt === undefined ? null : (
        <PromptView
          key={state.prompt.sequence}
          host={host}
          pending={state.prompt}
        />
      )}
      {state.status === "failed" ? (
        <Alert
          tone="error"
          title="That did not work"
          description={state.failure}
        />
      ) : null}
      <div className="flex justify-end gap-xs">
        {active ? (
          <Button variant="ghost" onClick={host.cancel}>
            Cancel
          </Button>
        ) : null}
        {state.status === "failed" ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                host.cancel();
                onClose?.();
              }}
            >
              Close
            </Button>
            {!state.retryable ? null : (
              <Button onClick={host.retry}>Try again</Button>
            )}
          </>
        ) : null}
        {state.status === "done" || state.status === "cancelled" ? (
          <Button onClick={onClose}>Done</Button>
        ) : null}
      </div>
    </section>
  );
}
