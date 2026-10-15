import { createWhistle, type WhistleRuntime } from "@fungi.computer/whistle";
import { describe, expect, it } from "vitest";

import {
  contributeReloadCommand,
  runSlashDraft,
  type ReloadSource,
} from "../src/headless.js";

/** Collect the notices a command sends to its human. */
function noticing(runtime: WhistleRuntime, notices: string[]) {
  return runtime.present(() => ({
    interaction: {
      signal: new AbortController().signal,
      prompt: () => Promise.reject(new Error("No prompts in this test")),
      notify: (notice) => {
        notices.push(notice.type === "handoff" ? notice.url : notice.message);
      },
    },
    settle: () => undefined,
  }));
}

describe("shared /reload", () => {
  it("refreshes only owners that support it and reports every category", async () => {
    const runtime = createWhistle();
    const notices: string[] = [];
    const reloaded: string[] = [];
    noticing(runtime, notices);
    const sources: ReloadSource[] = [
      {
        name: "model catalog",
        effect: "now",
        reload: () => {
          reloaded.push("models");
          return Promise.resolve();
        },
      },
      {
        name: "terminal colors",
        effect: "now",
        reload: () => Promise.reject(new Error("palette query refused")),
      },
      { name: "skills", effect: "next_turn" },
      {
        name: "client extensions",
        effect: "unsupported",
        reason: "no unload lifecycle",
      },
    ];
    const lease = contributeReloadCommand(runtime, {
      sourceId: "reload-test",
      namespace: "reload-test",
      sources: () => sources,
    });
    try {
      await runSlashDraft("/reload", runtime, () => undefined, "slash");
      expect(reloaded).toEqual(["models"]);
      expect(notices).toEqual([
        [
          "Refreshed now: model catalog.",
          "Failed: terminal colors (palette query refused).",
          "Re-read at the next turn: skills.",
          "Not reloadable: client extensions (no unload lifecycle).",
          "Active work and its captured context were not changed.",
        ].join("\n"),
      ]);
    } finally {
      lease.dispose();
    }
  });

  it("never reports a refresh when no owner supports one", async () => {
    const runtime = createWhistle();
    const notices: string[] = [];
    noticing(runtime, notices);
    const lease = contributeReloadCommand(runtime, {
      sourceId: "reload-empty",
      namespace: "reload-empty",
      sources: () => [
        { name: "keybindings", effect: "unsupported", reason: "no file" },
      ],
    });
    try {
      await runSlashDraft("/reload", runtime, () => undefined, "slash");
      expect(notices[0]?.split("\n")[0]).toBe("Refreshed now: nothing.");
    } finally {
      lease.dispose();
    }
  });
});
