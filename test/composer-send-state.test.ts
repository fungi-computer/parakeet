import { expect, it } from "vitest";
import { composerSendState } from "../src/components/ComposerShell.js";

it.each(["", " ", "\t\n"])(
  "rests empty draft %j in Caps' disabled empty state for both Apps",
  (draft) => {
    expect(composerSendState({ draft, busy: false })).toBe("empty");
    expect(
      composerSendState({ draft, busy: false, queueWhileBusy: true }),
    ).toBe("empty");
  },
);

it("preserves image-only chat, stop, recall and queued-follow-up semantics", () => {
  expect(
    composerSendState({ draft: "", hasAttachments: true, busy: false }),
  ).toBe("ready");
  expect(
    composerSendState({ draft: "", busy: true, queueWhileBusy: true }),
  ).toBe("busy");
  expect(
    composerSendState({ draft: "Follow up", busy: true, queueWhileBusy: true }),
  ).toBe("ready");
  expect(
    composerSendState({
      draft: "Follow up",
      busy: true,
      queueWhileBusy: true,
      blocked: true,
    }),
  ).toBe("busy");
  expect(composerSendState({ draft: "Generate", busy: true })).toBe("busy");
  expect(composerSendState({ draft: "Generate", busy: false })).toBe("ready");
});
