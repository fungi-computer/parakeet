# @fungi.computer/parakeet

## 0.19.3

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.24.0

## 0.19.2

### Patch Changes

- @fungi.computer/agar@0.29.4
  - @fungi.computer/knapsack@0.4.36
  - @fungi.computer/shiitake@0.23.9

## 0.19.1

### Patch Changes

- Changes since 0.19.0:

  - fix(parakeet): word a failed tool call as a failure, in its row and the
    summary
  - fix(parakeet): fold a failed tool call the run went past into a compact row

## 0.19.0

### Minor Changes

- Changes since 0.18.4:

  - fix(parakeet): tell the person a message description failed with a toast
  - feat(parakeet): hold the loading stage with the Caps Loader until Shiitake
    is ready
  - fix(parakeet): show only the live Sprite on the loading screen

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.14.3

## 0.18.4

### Patch Changes

- Changes since 0.18.3:

  - fix(parakeet): guard a client entry's message description

- Updated dependencies
  - @fungi.computer/shiitake@0.23.8

## 0.18.3

### Patch Changes

- Changes since 0.18.2:

  - fix(shiitake): let a client entry describe its extension's own messages
  - fix(parakeet): leave messages alone without outcomes and show the TUI row
    compactly
  - fix(parakeet): show answers from the question's own outcome and tie a card
    to its call
  - fix(parakeet): show answers as a row, name a waiting question, refresh a
    renamed Agent

- Updated dependencies
  - @fungi.computer/shiitake@0.23.7

## 0.18.2

### Patch Changes

- @fungi.computer/knapsack@0.4.35
  - @fungi.computer/shiitake@0.23.6

## 0.18.1

### Patch Changes

- Changes since 0.18.0:

  - fix(parakeet): keep a refusal visible without a toast host and wait honestly
  - fix(parakeet): show a refused answer as a toast and keep a disabled Send
    neutral
  - fix(parakeet): keep the composer usable and never preselect an answer

## 0.18.0

### Minor Changes

- Changes since 0.17.19:

  - feat(hub): park approvals until the person answers

### Patch Changes

- @fungi.computer/agar@0.29.3
  - @fungi.computer/shiitake@0.23.5

## 0.17.19

### Patch Changes

- @fungi.computer/knapsack@0.4.34
  - @fungi.computer/shiitake@0.23.4

## 0.17.18

### Patch Changes

- Updated dependencies
  - @fungi.computer/knapsack@0.4.33
  - @fungi.computer/shiitake@0.23.3

## 0.17.17

### Patch Changes

- @fungi.computer/agar@0.29.2
  - @fungi.computer/shiitake@0.23.2
  - @fungi.computer/knapsack@0.4.32

## 0.17.16

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/cairn@0.1.1
  - @fungi.computer/knapsack@0.4.31
  - @fungi.computer/agar@0.29.1
  - @fungi.computer/mule@0.4.1
  - @fungi.computer/shiitake@0.23.1
  - @fungi.computer/sprite@0.2.3
  - @fungi.computer/caps@0.14.2
  - @fungi.computer/sprite-zdog@0.3.3
  - @fungi.computer/bird-dog@0.3.10

## 0.17.15

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.14.2

## 0.17.14

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/mule@0.4.0
  - @fungi.computer/shiitake@0.23.0
  - @fungi.computer/knapsack@0.4.30

## 0.17.13

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.14.1

## 0.17.12

### Patch Changes

- Updated dependencies
  - @fungi.computer/mule@0.3.1
  - @fungi.computer/knapsack@0.4.29
  - @fungi.computer/shiitake@0.22.13

## 0.17.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.29.0
  - @fungi.computer/caps@0.14.0
  - @fungi.computer/shiitake@0.22.12

## 0.17.10

### Patch Changes

- Changes since 0.17.9:

  - fix(parakeet): show an agent reply once when the model sends commentary and
    a final answer

- Updated dependencies
  - @fungi.computer/shiitake@0.22.11
  - @fungi.computer/agar@0.28.5

## 0.17.9

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.22.10
  - @fungi.computer/agar@0.28.4
  - @fungi.computer/bird-dog@0.3.9
  - @fungi.computer/knapsack@0.4.28

## 0.17.8

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.28.3
  - @fungi.computer/shiitake@0.22.9

## 0.17.7

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.28.2
  - @fungi.computer/shiitake@0.22.8

## 0.17.6

### Patch Changes

- Changes since 0.17.5:

  - fix(parakeet): recover a failed script only by retrying it

## 0.17.5

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.28.1
  - @fungi.computer/shiitake@0.22.7

## 0.17.4

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.22.6

## 0.17.3

### Patch Changes

- Changes since 0.17.2:

  - fix(parakeet): no approval card preselects a choice
  - fix(parakeet): keep an approval choice across a hidden card and start blank
    after a gap
  - fix(grove): retain approval choices when the App connection changes
  - fix(parakeet): scope compact controls to chat composers
  - fix(parakeet): retain disclosure for rows without status
  - fix(grove): keep footer markers and narrow composer controls clear

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.28.0
  - @fungi.computer/caps@0.13.0
  - @fungi.computer/shiitake@0.22.5

## 0.17.2

### Patch Changes

- Changes since 0.17.1:

  - fix(grove): keep agent status rows compact and failures in toasts

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.27.2
  - @fungi.computer/caps@0.12.9
  - @fungi.computer/shiitake@0.22.4
  - @fungi.computer/knapsack@0.4.27

## 0.17.1

### Patch Changes

- Changes since 0.17.0:

  - fix(agar): end a failure message with a period
  - fix(agar): one source of failure wording that punctuates once and names a
    dropped request
  - fix(grove): every launch App failure toast names its real cause

- Updated dependencies
  - @fungi.computer/agar@0.27.1
  - @fungi.computer/shiitake@0.22.3

## 0.17.0

### Minor Changes

- Changes since 0.16.12:

  - fix(agar): reject invisible label characters and drop the unbacked undo
    claim
  - feat(agar): approval cards read a method's own short label

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.27.0
  - @fungi.computer/shiitake@0.22.2
  - @fungi.computer/knapsack@0.4.26

## 0.16.12

### Patch Changes

- Changes since 0.16.11:

  - fix(parakeet): show the full command prefix on an Always confirmation
  - fix(parakeet): deny only when the first question cannot be shown
  - fix(parakeet): a refused approval prompt denies the request and says so once
  - fix(parakeet): keep an approval card's title within a prompt's sixty
    characters
  - fix(grove): never take the composer over blank; say who must answer

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.26.0
  - @fungi.computer/caps@0.12.8
  - @fungi.computer/shiitake@0.22.1
  - @fungi.computer/knapsack@0.4.25

## 0.16.11

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.12.7
  - @fungi.computer/shiitake@0.22.0

## 0.16.10

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.12.6

## 0.16.9

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.12.5
  - @fungi.computer/agar@0.25.1
  - @fungi.computer/bird-dog@0.3.8
  - @fungi.computer/shiitake@0.21.16
  - @fungi.computer/knapsack@0.4.24

## 0.16.8

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.12.4

## 0.16.7

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.21.15

## 0.16.6

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.25.0
  - @fungi.computer/shiitake@0.21.14
  - @fungi.computer/knapsack@0.4.23

## 0.16.5

### Patch Changes

- Updated dependencies
  - @fungi.computer/knapsack@0.4.22
  - @fungi.computer/shiitake@0.21.13

## 0.16.4

### Patch Changes

- @fungi.computer/shiitake@0.21.12

## 0.16.3

### Patch Changes

- Changes since 0.16.2:

  - fix(grove): the chat box says Message and the Agent's live name

- Updated dependencies
  - @fungi.computer/caps@0.12.3

## 0.16.2

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.24.0
  - @fungi.computer/shiitake@0.21.11

## 0.16.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.23.2
  - @fungi.computer/shiitake@0.21.10

## 0.16.0

### Minor Changes

- Changes since 0.15.0:

  - fix(hub): keep the curtain proof, API docs and Desktop tests green
  - fix(hub): satisfy anti-slop in the boot failure screen
  - fix(hub): show a boot failure with its real cause
  - fix(hub): draw the curtain's stand-in face closer to the live mascot
  - fix(hub): never leave a boot failure under the curtain
  - feat(hub): one boot curtain and a Team name at sign-up

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.23.1
  - @fungi.computer/knapsack@0.4.21
  - @fungi.computer/shiitake@0.21.9

## 0.15.0

### Minor Changes

- Changes since 0.14.9:

  - feat(parakeet): hide the prompt author line while one person wrote every
    prompt

## 0.14.9

### Patch Changes

- @fungi.computer/shiitake@0.21.8

## 0.14.8

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.21.7

## 0.14.7

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.21.6

## 0.14.6

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.12.2
  - @fungi.computer/shiitake@0.21.5

## 0.14.5

### Patch Changes

- Changes since 0.14.4:

  - fix(hub): say what to do when a model needs more credit than the Team has

## 0.14.4

### Patch Changes

- @fungi.computer/shiitake@0.21.4

## 0.14.3

### Patch Changes

- @fungi.computer/shiitake@0.21.3

## 0.14.2

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.23.0
  - @fungi.computer/shiitake@0.21.2

## 0.14.1

### Patch Changes

- @fungi.computer/shiitake@0.21.1

## 0.14.0

### Minor Changes

- Changes since 0.13.3:

  - feat(parakeet): show a refused secret as a toast with a key settings link

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/mule@0.3.0
  - @fungi.computer/shiitake@0.21.0
  - @fungi.computer/knapsack@0.4.20

## 0.13.3

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.22.1
  - @fungi.computer/shiitake@0.20.4

## 0.13.2

### Patch Changes

- Changes since 0.13.1:

  - fix(parakeet): show waiting for you in the composer only for an open item

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.22.0
  - @fungi.computer/caps@0.12.1
  - @fungi.computer/mule@0.2.7
  - @fungi.computer/shiitake@0.20.3
  - @fungi.computer/knapsack@0.4.19

## 0.13.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/mule@0.2.6
  - @fungi.computer/knapsack@0.4.18
  - @fungi.computer/shiitake@0.20.2

## 0.13.0

### Minor Changes

- Changes since 0.12.5:

  - fix(agents): keep the self source off the head of the Oyster tool roster
  - feat(parakeet): show the Agent's own head on its rename row
  - feat(agents): let an Agent rename itself and change its own avatar

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.21.0
  - @fungi.computer/gills@0.4.0
  - @fungi.computer/shiitake@0.20.1
  - @fungi.computer/knapsack@0.4.17

## 0.12.5

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.20.0
  - @fungi.computer/shiitake@0.20.0
  - @fungi.computer/knapsack@0.4.16

## 0.12.4

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/mule@0.2.5
  - @fungi.computer/shiitake@0.19.2
  - @fungi.computer/knapsack@0.4.15

## 0.12.3

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.19.0
  - @fungi.computer/shiitake@0.19.1

## 0.12.2

### Patch Changes

- Changes since 0.12.1:

  - fix(approvals): isolate waiting calls and name App write permissions
  - fix(agents): explain typed quota limits without retry advice

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.18.2
  - @fungi.computer/caps@0.12.0
  - @fungi.computer/mule@0.2.4
  - @fungi.computer/shiitake@0.19.0
  - @fungi.computer/knapsack@0.4.14
  - @fungi.computer/bird-dog@0.3.7

## 0.12.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.18.1
  - @fungi.computer/shiitake@0.18.3

## 0.12.0

### Minor Changes

- Changes since 0.11.38:

  - fix(parakeet): render the transcript as a column-reverse scroller
  - fix(parakeet): keep the timeline following the latest output
  - feat(parakeet): own the in-view conversation and its opening in one place

## 0.11.38

### Patch Changes

- Changes since 0.11.37:

  - fix(parakeet): make composer keys 44px touch targets on phones

## 0.11.37

### Patch Changes

- Changes since 0.11.36:

  - fix(parakeet): keep the output box whole, fade only the scroller, leave the
    composer inset
  - fix(approvals): word every refused approval in plain language
  - fix(parakeet): fade tool output edges, continue the turn rail, close the end
    gap

## 0.11.36

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.18.0
  - @fungi.computer/shiitake@0.18.2

## 0.11.35

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.11.7

## 0.11.34

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.17.0
  - @fungi.computer/shiitake@0.18.1

## 0.11.33

### Patch Changes

- Changes since 0.11.32:

  - fix(parakeet): show the Caps focus ring on the history scroller
  - fix(parakeet): show the Caps focus ring on the history scroller
  - fix(parakeet): follow the latest output after End in pinned history

## 0.11.32

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.11.6

## 0.11.31

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.18.0

## 0.11.30

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.16.0
  - @fungi.computer/shiitake@0.17.1
  - @fungi.computer/knapsack@0.4.13

## 0.11.29

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.17.0

## 0.11.28

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.15.0
  - @fungi.computer/caps@0.11.5
  - @fungi.computer/shiitake@0.16.2

## 0.11.27

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.14.0
  - @fungi.computer/shiitake@0.16.1

## 0.11.26

### Patch Changes

- Changes since 0.11.25:

  - fix(parakeet): hide the script when an execute row is only its one command
  - fix(parakeet): name an execute row's tool and command, not its script

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.13.0
  - @fungi.computer/caps@0.11.4
  - @fungi.computer/shiitake@0.16.0
  - @fungi.computer/sigils@0.3.2
  - @fungi.computer/knapsack@0.4.12

## 0.11.25

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.12.1
  - @fungi.computer/shiitake@0.15.0
  - @fungi.computer/knapsack@0.4.11

## 0.11.24

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.12.0
  - @fungi.computer/shiitake@0.14.2
  - @fungi.computer/knapsack@0.4.10

## 0.11.23

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.11.0
  - @fungi.computer/shiitake@0.14.1

## 0.11.22

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.10.1
  - @fungi.computer/shiitake@0.14.0

## 0.11.21

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.11.3

## 0.11.20

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.11.2

## 0.11.19

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.11.1

## 0.11.18

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.10.0
  - @fungi.computer/caps@0.11.0
  - @fungi.computer/shiitake@0.13.1

## 0.11.17

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.8

## 0.11.16

### Patch Changes

- Changes since 0.11.15:

  - fix(parakeet,graft): keep redacted reasoning placeholders out of thoughts
  - fix(parakeet): hide thinking rows with no visible text and align tool steps

## 0.11.15

### Patch Changes

- Changes since 0.11.14:

  - fix(parakeet): keep the last row clear of the jump-to-bottom control
  - fix(parakeet,grove,prints): three usability bugs

## 0.11.14

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.7

## 0.11.13

### Patch Changes

- Changes since 0.11.12:

  - fix(parakeet,grove): keep a failed edit failed when only a read follows
  - fix(parakeet,grove): recover a tool failure only through its own retry
  - fix(grove): show a recovered tool failure once and centre the no-model
    welcome

- Updated dependencies
  - @fungi.computer/caps@0.10.6

## 0.11.12

### Patch Changes

- Changes since 0.11.11:

  - fix(grove): offer model settings for tool limitations
  - fix(grove): keep tool-limited models out of agent choices

## 0.11.11

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.13.0

## 0.11.10

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.5

## 0.11.9

### Patch Changes

- Updated dependencies
  - @fungi.computer/sigils@0.3.1
  - @fungi.computer/caps@0.10.4

## 0.11.8

### Patch Changes

- Changes since 0.11.7:

  - fix(tui): explain shortcut sequences and verify audit sizes

- Updated dependencies
  - @fungi.computer/caps@0.10.4

## 0.11.7

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.3

## 0.11.6

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.2

## 0.11.5

### Patch Changes

- Changes since 0.11.4:

  - fix(grove): show one central model setup notice

## 0.11.4

### Patch Changes

- Updated dependencies
  - @fungi.computer/agar@0.9.1
  - @fungi.computer/shiitake@0.12.4

## 0.11.3

### Patch Changes

- Changes since 0.11.2:

  - fix(nacre): deliver setup facts and fixes to every App (#393)

## 0.11.2

### Patch Changes

- Changes since 0.11.1:

  - fix(grove): model setup instead of a run failure; one inline failure line
    (#380)

## 0.11.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.1

## 0.11.0

### Minor Changes

- Changes since 0.10.0:

  - feat(grove): open a conversation with the Agent and focus the composer

### Patch Changes

- Updated dependencies
  - @fungi.computer/caps@0.10.0

## 0.10.0

### Minor Changes

- Changes since 0.9.2:

  - feat(grove): setup-first first run, clickable starters, fewer steps to a
    first Agent
  - feat(parakeet): connect-a-model panel up front, specific Retry name
  - feat(parakeet): one plain failure line, the setup notice for no model, host
    starters
  - fix(parakeet): build the package before its docs check

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.9.0
  - @fungi.computer/caps@0.9.0
  - @fungi.computer/gills@0.3.0
  - @fungi.computer/sprite@0.2.2
  - @fungi.computer/shiitake@0.12.3
  - @fungi.computer/sprite-zdog@0.3.2
  - @fungi.computer/knapsack@0.4.9

## 0.9.2

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.8.0
  - @fungi.computer/caps@0.8.0
  - @fungi.computer/shiitake@0.12.2
  - @fungi.computer/sprite@0.2.1
  - @fungi.computer/knapsack@0.4.8
  - @fungi.computer/sprite-zdog@0.3.1
  - @fungi.computer/sigils@0.3.0
  - @fungi.computer/bird-dog@0.3.6

## 0.9.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.12.1
  - @fungi.computer/knapsack@0.4.7
  - @fungi.computer/agar@0.7.3
  - @fungi.computer/bird-dog@0.3.5

## 0.9.0

### Minor Changes

- Changes since 0.8.2:

  - fix(oyster): qualify the packed dependency inventory for strangers
  - fix(parakeet): call admitted model picker directly
  - fix(parakeet): open shared model picker from Settings row
  - feat(grove): pick host-admitted Agent models through shared Session command
  - fix(grove): merge integration and restore composer model picker

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.7.2
  - @fungi.computer/bird-dog@0.3.4
  - @fungi.computer/gills@0.2.2
  - @fungi.computer/shiitake@0.12.0
  - @fungi.computer/knapsack@0.4.6

## 0.8.2

### Patch Changes

- Changes since 0.8.1:

  - fix(oyster): complete runtime dependency qualification closure

- Updated dependencies
- Updated dependencies
  - @fungi.computer/bird-dog@0.3.3
  - @fungi.computer/shiitake@0.11.1
  - @fungi.computer/caps@0.7.1

## 0.8.1

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.11.0

## 0.8.0

### Minor Changes

- Changes since 0.7.2:

  - fix(oyster): satisfy the lint and suppression budgets for the website
    channel
  - feat(oyster): ask a Turnstile-protected site's visitors for the check

### Patch Changes

- Updated dependencies
  - @fungi.computer/shiitake@0.10.0

## 0.7.2

### Patch Changes

- Changes since 0.7.1:

  - fix(workbench): repair the root browser proofs the nightly first ran
  - fix(tests): keep proof evidence and logs out of the operator's home

- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.7.1
  - @fungi.computer/gills@0.2.1
  - @fungi.computer/agar@0.7.1
  - @fungi.computer/shiitake@0.9.2
  - @fungi.computer/knapsack@0.4.5
  - @fungi.computer/bird-dog@0.3.2

## 0.7.1

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/agar@0.7.0
  - @fungi.computer/caps@0.7.0
  - @fungi.computer/shiitake@0.9.1
  - @fungi.computer/knapsack@0.4.4

## 0.7.0

### Minor Changes

- Changes since 0.6.2:

  - feat(shiitake): retain bounded Session feeds on current Integration

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @fungi.computer/shiitake@0.9.0
  - @fungi.computer/sigils@0.3.0
  - @fungi.computer/knapsack@0.4.3
  - @fungi.computer/caps@0.6.0

## 0.6.2

### Patch Changes

- Updated dependencies
  - @fungi.computer/sigils@0.2.2
  - @fungi.computer/caps@0.6.0

## 0.6.1

### Patch Changes

- Changes since 0.6.0:

  - fix(tui): carry real occupancy phases and show cancelling

- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @fungi.computer/caps@0.6.0
  - @fungi.computer/shiitake@0.8.0
  - @fungi.computer/sigils@0.2.1
  - @fungi.computer/agar@0.6.1
  - @fungi.computer/knapsack@0.4.2

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
