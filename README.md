# Parakeet (`@fungi.computer/parakeet`)

Parakeet renders an Agent conversation from a typed Shiitake Session. Browser
hosts use its React view; terminal hosts use its headless hooks to render the
same history, composer and status through their own UI.

Website hosts mount the same `Parakeet` component inside an isolated iframe. A
visitor-session adapter supplies the visitor's scoped Session read, watch and
prompt commands; credentials and admission remain with the host.
`markdownPolicy="visitor"` renders Markdown links without loading images or
unsafe destinations. A prompt recorded for a human returns `status: "recorded"`,
not a fabricated Agent-work acceptance. Closing the view stops observation, not
the Agent's work. Pass `visitor={{ agentName: "Front Desk" }}` to hide model,
usage and command controls. Slash-prefixed text remains a normal visitor
message; the visitor mode does not register or execute slash commands.

## Set up

Install `@fungi.computer/parakeet` from its package tarball. It requires a
compatible React and React DOM pair, TanStack Query and an authorized Session
supplied by the host. The manifest supports React 18.2 or 19.2 and later within
those major versions. Build the dependency closure from the repository root:

```sh
pnpm turbo:run run build --filter=@fungi.computer/parakeet
```

Browser hosts import `@fungi.computer/parakeet/styles.css` once. It includes the
Caps/Stipe foundation and conversation utilities. Do not also load
`@fungi.computer/caps/styles.css` in that document. Import Caps' `fonts.css`
separately when using its bundled fonts, with font URLs handled by your bundler.

A host compiling its own Tailwind utilities uses the `/tailwind.css` source
instead and supplies its own `@source`. The built stylesheet cannot scan your
host's additional classes.

## Quick start in a browser

Illustrative: your host supplies the authorized `ParakeetSession` and a browser
bundler that handles CSS. This component owns its query cache and clears it on
unmount. It does not create an Agent, sign in or grant tools.

```tsx
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Parakeet, type ParakeetSession } from "@fungi.computer/parakeet";
import "@fungi.computer/parakeet/styles.css";

export function Conversation({ session }: { session: ParakeetSession }) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => () => queryClient.clear(), [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Parakeet session={session} />
    </QueryClientProvider>
  );
}
```

Parakeet never reads a message's host metadata itself. To show who wrote a line,
pass `authorOf`: your reading of that metadata into a `ParakeetAuthor`
(`{ id, name }`). A Fungi app passes `messageAuthor` from
`@fungi.computer/hub-client/message-meta`; without it, lines show no author.

The view presents the Session's observed history, live work, composer and
errors. Screen readers receive the same Session status as the composer footer
through a hidden polite live region; streamed transcript tokens are outside that
region. The Session transport stays owned by the caller. Releasing observation
does not cancel accepted work or close a borrowed Agent. When replacing a
Session, provide its new handle rather than copying a snapshot into another
writable store.

The [standalone composer tests](test/standalone-composer.test.tsx) exercise the
provider, query cache, observations and prompt admission with typed fixtures.
The browser contract uses the real component with a fixture Session. A fake
Session checks the component, not hosted authentication or a model provider.

## Core concepts

| Surface                             | What it owns                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Parakeet`                          | The browser conversation, including provider and view.                                              |
| `ParakeetProvider` / `ParakeetView` | Separate composition when the host needs custom controls in the same conversation scope.            |
| `useTimeline()`                     | Durable history and the replaceable live tail, bounded history paging and model/usage presentation. |
| `useComposer()`                     | Draft, submission, pending work, cancellation and retry controls.                                   |
| `useStatus()`                       | Observed work and connection state, including goal controls.                                        |
| `useMarkdown(content)`              | Parsed chat Markdown for custom and terminal renderers.                                             |

Both composition forms require the host's `QueryClientProvider`. `Parakeet`
takes the `session` directly. With separate composition, pass `session` to
`ParakeetProvider` and put `ParakeetView` and custom hook consumers beneath it.
Pass `commands` and presentation props to the view, not the provider.

`Parakeet` and `ParakeetView` share these optional presentation props:

| Prop                        | Contract                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| `composerActionVariant`     | `"primary"` or `"outline"`.                                             |
| `renderToolActions`         | Renders host actions for a completed `ToolItem`.                        |
| `renderAssistantAttachment` | Receives the original settled reply text.                               |
| `formatAssistantText`       | Changes displayed reply text without changing the attachment input.     |
| `onLink`                    | Receives a transcript URL; return `true` to prevent browser navigation. |
| `empty`                     | Replaces the empty conversation content.                                |

Import renderer-neutral hooks from `/headless` in the terminal. That entry
avoids loading the DOM presentation, Caps and Sprite closure. The root exports
those same hooks for browser callers. They share the Session's TanStack Query
cache. Derived atoms select observed values rather than duplicating Session
truth. History pages share the host's cache by Session address and survive
provider remounts until that cache expires. Paging retains four 100-message
pages, with bounded return cursors for the Session's before-only read API.
Jumping to latest cancels the outstanding history fetch and clears that shared
history window; the live observation remains separate.

Tool calls are grouped in the shared projection. Browser and terminal renderers
receive the same typed summaries, error-first sections and edit diffs.
Disclosure state belongs to the view. A goal row displays the committed goal;
pausing it leaves current accepted work running. Idle conversation state does
not mean the goal is complete.

## Commands and errors

A host may supply its Whistle runtime through `commands`. Parakeet builds the
slash registry from that host, its built-ins and advertised extension catalogs.
It owns parsing, completion, stable request identities and interaction state.
The browser and terminal render the same questions, choices and notices.
`/model` and `/thinking` use that interaction path.

`ParakeetProvider` accepts `onToast` for transient command information. The host
renders it through its existing toast owner: the terminal's shared toast
viewport or Grove's `ui.showToast`. `ParakeetInteractions.toast` and
`subscribeToasts` expose the same renderer-neutral seam. Ordinary first-success
echoes are silent, including after a dialog completes. Progress, questions and
handoffs remain in their interaction while active; failures retain their retry
or attention UI rather than expiring as information.

After Try again, a final information or success notice stays in that
interaction's existing result row until Done/close, without an extra toast. A
producer that supplies no completion notice does not gain a fabricated result.

Account commands are provider-neutral. The host's account owner and policy
decide which login methods are available. The presentation layer does not gain a
credential store or make an advertised command authorized.

Queued timeline rows offer Cancel through
`useTimeline().cancelQueued(commandId)`. The row disappears immediately while
the existing Session owner decides the pending-only cancellation. This never
stops the running turn or restores text to the composer. TooLate or an
unconfirmed response produces a warning and restores any row still reported as
queued; an accepted response stays hidden through stale queued snapshots until
the owner projection catches up. Only one queued gesture waits for its owner at
a time, and switching conversations discards its presentation state. Recall
remains a separate restore-to-composer gesture.

The composer reconciles optimistic prompts with owner facts by request identity.
Submitting clears the draft immediately and adds a faded pending message.
Acceptance restores normal emphasis; owner-queued messages remain faded. If
admission fails, the exact submitted text returns to the composer and the host
receives an error toast. Any newer draft stays first, followed by a blank line
and the restored text; acceptance never clears newer typing. An uncertain
admission retains its request identity while the owner resolves it. An accepted
resolution confirms the admitted command or recorded entry; only confirmed
withdrawal restores the draft and permits retry with a new request identity,
because the old identity is durably fenced. Retrying failed or interrupted
durable work also submits a new request identity, preserving the failed prompt's
text and image cargo, including image-only prompts after live-page eviction. It
does not consume a newer unsent draft. Failed observation shows connection
failure; reconnecting does not prove pending work failed or resubmit it
automatically. Typed command errors remain visible and retryable. The host
remains responsible for the Session transport, current permissions and operator
diagnostics.

An owner's accepted withdrawal receipt can name a run-free recorded entry:
`receipt.commandId === message.id` even though `message.commandId === null`.
That receipt confirms durable recording, not cancellation or model admission. A
translating host retains the original composer identity in its durable metadata
and projects it as `messages[].requestId` or `pending.prompts[].requestId`; its
internal admission key is not that identity.

## API and examples

Use the [generated API reference](docs/api/README.md) and
[exports](package.json). The root owns browser components, `/headless` owns
shared hooks, `/slash` owns command grammar, and `/agent-head` owns Agent
appearance contracts.

[Transcript stories](workbench/transcript.stories.tsx) show settled, streaming
and failed replies. [Tool group stories](workbench/tool-groups.stories.tsx) show
shared projections. [Slash parity tests](test/slash-parity.test.tsx) check the
common interaction contract.
[Headless surface tests](test/headless-surface.test.ts) check that non-browser
imports stay independent of the DOM view.

## Contribute and license

Add a fixture case to the nearest conversation, command or rendering test. From
the repository root:

```sh
pnpm --dir packages/parakeet run test
pnpm --dir packages/parakeet run browser:contract
pnpm --dir packages/parakeet run docs
```

The browser contract needs the repository's configured browser tooling. Unit
checks do not replace that proof. Parakeet is MIT licensed; see
[LICENSE](LICENSE).

## TypeScript consumer dependencies

Install `@modelcontextprotocol/sdk@1.25.2` alongside this package when compiling
its complete public declarations. The shared provider SDK imports those types
through an optional peer; the packed consumer supplies it explicitly. This does
not require a provider account or make a provider call.

## Packed consumer readiness

Run `pnpm run build`, `pnpm run pack` and `pnpm run stranger` in this package.
The maintained stranger proof installs only package tarballs into a fresh npm
consumer, checks the exact shipped files, runs the public runtime fixture and
compiles every JavaScript entrypoint with strict NodeNext and no library-check
skip. This qualification does not publish npm releases or push a repository
split.

See [LICENSE](LICENSE) for the license and the package manifest for its public
repository destination.
