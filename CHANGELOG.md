# @fungi.computer/parakeet

## 0.6.0

### Minor Changes

- Changes since 0.5.0:

  - fix(tui): show Agent activity instead of queued-message blockers
  - fix(composer): align native keys, empty Send and usage readouts
  - fix(parakeet): use the Caps attachment remove face
  - feat(composer): finish native row controls and responsive parity
  - fix(parakeet): use Caps for released controls
  - fix(parakeet): retain audited S7 follow-ups on current Integration
  - fix(oyster): report new Sessions and release cancelled RPC streams
  - feat(parakeet): share Grove and Prints composer geometry
  - fix(parakeet): hide narrow attention captions accessibly
  - fix(grove): keep phone controls and Inbox status aligned
  - fix(parakeet): report unavailable draft storage without a notice
  - fix(grove): checkpoint status dots and draft regression
  - fix(parakeet): share live and final display character policy
  - fix(shiitake): name work blocking queued conversations
  - fix(parakeet): keep folded live tails and row keys stable
  - fix(shiitake): bound progress flush latency and strengthen delta proofs
  - feat(parakeet): show live tool tails in existing call rows
  - fix(shiitake): stream bounded offset append progress across all clients
  - fix: restack live tail on qualified Local streams
  - fix: restack Computer streams on corrected live text policy

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.6.0
  - @fungi.computer/bird-dog@0.3.1
  - @fungi.computer/caps@0.5.0
  - @fungi.computer/shiitake@0.7.0
  - @fungi.computer/sprite-zdog@0.3.0
  - @fungi.computer/knapsack@0.4.1

## 0.5.0

### Minor Changes

- Changes since 0.4.0:

  - fix(parakeet): draw a multiple decision's picks as Caps checks
  - fix(parakeet): polish the composer questions on the web and the terminal
  - fix(parakeet): open waiting decisions by their typed command key
  - refactor(whistle)!: execute commands by their typed key; only Whistle mints
    ids
  - feat(composer): one Caps composer surface for chat and Prints
  - fix(parakeet): join the completion menu to the composer surface
  - fix(parakeet): keep PromptContent self-contained so its signature leaks no
    private type
  - fix(clients): explain the occupied offline prompt slot
  - fix(parakeet): reset disposable draft journals safely
  - fix(prints): share Grove's completion menu so arrow keys work
  - fix(parakeet): confirm the family rule and keep approvals steady across
    resizes
  - fix(parakeet): the Other row is the Listbox's last row, not a field beneath
    it
  - feat(parakeet): answer tool approvals in the composer on the terminal and
    the web
  - feat(parakeet): answer questions in the composer on the terminal and the web
  - fix(parakeet): summarize repeated provider errors and disclose raw details
  - feat(parakeet): let a host claim a tool result's images
  - fix(clients): finish live recovery and prove single frame application
  - fix(parakeet): require a delivered age in offline proof
  - fix(parakeet): prove delivered reply age survives watch loss
  - fix(tui): read observed reply age through Parakeet
  - fix(parakeet): remove non-falsifiable retry prompt proof
  - fix(tui): checkpoint bounded live client recovery

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.5.0
  - @fungi.computer/bird-dog@0.3.0
  - @fungi.computer/caps@0.4.0
  - @fungi.computer/knapsack@0.4.0
  - @fungi.computer/shiitake@0.6.0
  - @fungi.computer/whistle@0.3.0

## 0.4.0

### Minor Changes

- Changes since 0.3.0:

  - fix(tui): footer stop loop asks first; modal rules walk the real producers
  - fix(parakeet): strip terminal programs before bounding diagnostics
  - fix(parakeet): redact terminal diagnostics before display cutoff
  - feat(tui): migrate the Loop, extension, Archive, Skills, question and
    recovery modals
  - fix(parakeet): redact and clarify turn failure notices
  - fix(parakeet): no current marker on the sign-in provider list
  - feat(tui): migrate the model, sign-in, resume, fork and Home pickers to the
    shared modal
  - fix(grove): show interrupted model reason with retry
  - feat(tui): shared modal anatomy with safe-first confirmations and Goal
    paused

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.4.0
  - @fungi.computer/bird-dog@0.2.1
  - @fungi.computer/caps@0.3.1
  - @fungi.computer/knapsack@0.3.1
  - @fungi.computer/shiitake@0.5.0
  - @fungi.computer/whistle@0.2.0

## 0.3.0

### Minor Changes

- Changes since 0.2.1:

  - feat(parakeet): keep Enter for newline on touch
  - fix(shiitake): target queued session activity wakes
  - fix: isolate provider prose to recorded failed turns
  - fix: project readonly provider error without mutation
  - fix: retain provider error text on failed turns

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.3.0
  - @fungi.computer/knapsack@0.3.0
  - @fungi.computer/shiitake@0.4.0
  - @fungi.computer/agar@0.3.1

## 0.2.1

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/knapsack@0.2.1
  - @fungi.computer/shiitake@0.3.1

## 0.2.0

### Minor Changes

- Changes since 0.1.0:

  - feat(stranger): typecheck each public entry in its own environment
  - fix(stranger): align the Oyster closure inventories and local dependencies
  - fix(parakeet): keep sandboxed drafts session-only when storage is denied
  - fix(parakeet): retire unanswered advertised prompts with their intents
  - feat(mule,shiitake,parakeet)!: separate tool data from model values
  - fix(tui): qualify current fixtures and simplify independent consumers
  - feat(tui): isolate independent leader and Grove bundle
  - test(parakeet): await running projection in queued cancel proof
  - fix(parakeet): cancel queued messages optimistically
  - fix(whistle): reuse normal rows after command retry
  - test(parakeet): qualify current goal-clear contracts
  - feat(shiitake): expose unknown request outcomes and fleet receipts
  - fix(whistle): discard secret answers between attempts
  - fix(goal): pin cleared events to committed session positions
  - fix(whistle): retry the failed interaction operation
  - refactor(files): split search tools and align hosted ignore visibility
  - fix(goal): type pause causes and restrict human attention
  - test(parakeet): await watch-first owner identity
  - fix(parakeet): announce compact pending messages accessibly
  - fix(parakeet): close joined admission and visitor contracts
  - fix(parakeet): record timed-out observation on its existing query
  - fix(spore): retain outage recovery until a fresh session snapshot
  - fix(hub): preserve caller identity through request withdrawal
  - fix(parakeet): reconcile durable recorded reply receipts
  - fix(recall): preserve image cargo through withdrawn admission retry
  - chore(recall): preserve adapter and proof work for update custody
  - fix(parakeet): persist consumed commands before clearing the draft
  - fix(parakeet): persist consumed commands before clearing the draft
  - fix(parakeet): qualify joined recall payload and fixture contracts
  - feat(parakeet): compose empty-Up recall with the stable draft journal
  - fix(parakeet): checkpoint durable drafts by logical owner identity
  - test(parakeet): cover retained recall recovery and restore failure
  - feat(parakeet): add Session-scoped pending recall state
  - fix(shiitake): publish durable tool call identity for live output
  - test(tui): align picker callers and capture populated flows
  - docs(parakeet): regenerate typed toast interaction API
  - fix(tui): clear picker commands and expose local management
  - test(toasts): remove obsolete success-dialog expectations
  - fix(tui): finish toast dismissal and attention lifecycles
  - fix(parakeet): quiet composer footer without losing accessible guidance
  - fix(parakeet): send composer drafts optimistically across clients
  - fix(spore): commit single choices without a second confirmation
  - feat(shiitake): carry process-local tool output snapshots
  - feat(tui): one toast owner; footer keeps only attention items
  - refactor(parakeet): test the timeline key callback through its own hook
  - perf(parakeet): stop re-enumerating history keys on text-only progress
  - fix(truffle): make the blank-key refusal fixed by type and prove it end to
    end
  - fix(truffle): show a refused blank API key as plain No key entered in /login
  - feat(shiitake): drop an insufficient background summary before appending
  - fix(tui): keep only a post-dismissal line as the cancel notice
  - fix(tui): make Esc during sign-in a calm cancel
  - fix(shiitake): label stale notices and type usage as stale-only
  - fix(stage): detect WebGL up front, wait for voices, and test the opening
    owner
  - feat(shiitake): add compaction head check and stale notice
  - refactor(parakeet): own conversation opening so Stage stops importing Grove
    source
  - feat(shiitake): store compactions as head, model and data, and rewrite old
    rows
  - fix(parakeet): space the agent message sigil and separator like tool rows
  - feat(tui): collapse another Agent's message behind the agent Sigil
  - fix(agent-message): one author shape, agent wording for a failed Agent
    message
  - fix(tui): one provider/model (level) formatter for the footer and the
    landing
  - feat(session): show another Agent's message as a compact block
  - fix(tui): thread the question extension id from the CLI entry
  - fix(corral): only question headers reach herdr; blocked survives command
    work
  - feat(corral): herdr shows an open agent question as blocked
  - fix(session): hide goal and loop prompts, summarize in footer, drop unused
    history
  - feat(session): show goal and loop automation in the footer, not the timeline
  - feat(oyster): public release 0.2.0
  - feat(sprite): inherit an optional animation clock through React
  - test(parakeet): satisfy frame-time test lint
  - feat(sprite): allow frame-driven agent head animation

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.3.0
  - @fungi.computer/cairn@0.1.0
  - @fungi.computer/caps@0.2.0
  - @fungi.computer/gills@0.2.0
  - @fungi.computer/knapsack@0.2.0
  - @fungi.computer/shiitake@0.3.0
  - @fungi.computer/sigils@0.2.0
  - @fungi.computer/sprite-zdog@0.2.0
  - @fungi.computer/sprite@0.2.0
  - @fungi.computer/whistle@0.1.0

## 0.1.0

### Minor Changes

- Changes since 0.0.1:

  - refactor(parakeet): let slash definitions consume drafts
  - fix(cli): polish help, diagnostics and slash commands
  - feat(cli): first-release surface: one sign-in question, npm update, landing
  - feat(agents): make the avatar a property of the Agent, not the conversation
  - feat(grove): live paused avatars in the agent rail
  - fix(caps): scan compiled components when Caps and Parakeet install from npm
  - feat(sigils): wire round-two Sigils into every surface
  - feat(oyster): public release 0.1.0

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.1.0
  - @fungi.computer/gills@0.1.0
  - @fungi.computer/knapsack@0.1.0
  - @fungi.computer/shiitake@0.2.0
  - @fungi.computer/sigils@0.1.0
  - @fungi.computer/sprite-zdog@0.1.0
  - @fungi.computer/sprite@0.1.0
  - @fungi.computer/whistle@0.0.2

## 0.0.1

### Patch Changes

- Initial public release of @fungi.computer/parakeet.
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.0.2
  - @fungi.computer/knapsack@0.0.2
  - @fungi.computer/shiitake@0.1.0
