/* global console, document, setTimeout */
// Avatars S1/S2 browser proof: fallback pixel-identity, the still-frame
// cache's live-player cap, and descriptor-driven heads (mushroom/cat/burger;
// colour swap on/off). Run the standard workbench from the repo root:
//   pnpm workbench:prepare
//   pnpm exec ladle serve --host 127.0.0.1 --port 61000
// Keep the full story inventory: the root storyOrder references other packages.
// In another terminal, run this proof against that server:
//   pnpm --dir packages/parakeet exec node test/browser/agent-head-avatars.browser.mjs
// Screenshots go to AGENT_HEAD_AVATAR_SHOTS, default
// ~/Botanical-cto/polish-shots/2026-10-07/avatars-s2/.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import process from "node:process";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.AGENT_HEAD_WORKBENCH_URL ?? "http://127.0.0.1:61000";
const shots =
  process.env.AGENT_HEAD_AVATAR_SHOTS ??
  resolve(homedir(), "Botanical-cto/polish-shots/2026-10-07/avatars-s2");
await mkdir(shots, { recursive: true });

const story = (id, theme) => `${base}/?story=${id}&mode=preview&theme=${theme}`;
const settle = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));

const browser = await chromium.launch();
try {
  // --- 1. Fallback comparison: pixel-identical old-literal vs new AgentHead ---
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(story("parakeet--agent-heads--fallback-comparison", theme));
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid^="legacy-"]').length === 6 &&
        document.querySelectorAll('[data-testid^="new-"]').length === 6,
    );
    await settle(600);
    const seeds = [
      "agent-gardener",
      "agent-librarian",
      "agent-maker",
      "agent-scribe",
      "agent-sprout",
      "agent-moss",
    ];
    for (const seed of seeds) {
      const legacy = await page
        .locator(`[data-testid="legacy-${seed}"]`)
        .screenshot();
      const updated = await page
        .locator(`[data-testid="new-${seed}"]`)
        .screenshot();
      assert.deepEqual(
        legacy,
        updated,
        `${seed} (${theme}): new AgentHead fallback must be pixel-identical to the old literal Sprite call`,
      );
    }
    await page.screenshot({
      path: `${shots}/fallback-comparison-${theme}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, [], `${theme} fallback page has no errors`);
    await page.close();
    console.log(`fallback comparison (${theme}): all 6 seeds pixel-identical`);
  }

  // --- 2. Fifty heads: at most 2 live players ---
  {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 600 },
    });
    await page.goto(story("parakeet--agent-heads--fifty-heads", "light"));
    await page.waitForFunction(
      () => document.querySelectorAll("[data-agent-head]").length === 50,
    );
    // Give the idle heads time to render their first frame and cache it.
    await settle(1500);
    const liveCount = await page.evaluate(
      () => document.querySelectorAll("[data-sprite-status]").length,
    );
    await page.screenshot({
      path: `${shots}/fifty-heads-light.png`,
      fullPage: true,
    });
    assert.ok(
      liveCount <= 2,
      `fifty heads: expected at most 2 live [data-sprite-status] players, got ${liveCount}`,
    );
    await page.close();
    console.log(`fifty heads: ${liveCount} live players (<= 2)`);
  }

  // --- 3. Styled idle heads never fall back to a cached frame ---
  {
    const page = await browser.newPage({
      viewport: { width: 900, height: 300 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(story("parakeet--agent-heads--styled-head", "light"));
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="styled-"]').length >= 2,
    );
    // Long enough to pass through "ready" at least twice, so a wrongly
    // cached frame would have had every chance to take over.
    await settle(1500);
    const filteredCount = await page.evaluate(
      () =>
        document.querySelectorAll(
          '[data-testid="styled-head"] [style*="filter"]',
        ).length,
    );
    const imgCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid="styled-head"] img').length,
    );
    await page.screenshot({
      path: `${shots}/styled-head-light.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, [], "styled head page has no errors");
    assert.equal(
      imgCount,
      0,
      "a manga idle head must never show a cached <img>",
    );
    assert.ok(
      filteredCount >= 2,
      `expected both manga heads to carry a live CSS filter, got ${filteredCount}`,
    );
    await page.close();
    console.log(
      `styled head: no cached <img>, ${filteredCount} heads keep their live filter`,
    );
  }

  // --- 4. Descriptors: mushroom/cat/burger render, colour swap on/off ---
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(story("parakeet--agent-heads--descriptors", theme));
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="member-"]').length === 3,
    );
    await settle(800);
    for (const character of ["mushroom", "cat", "burger"]) {
      const member = await page
        .locator(`[data-testid="member-${character}"]`)
        .screenshot();
      const shift = await page
        .locator(`[data-testid="shift-${character}"]`)
        .screenshot();
      const keep = await page
        .locator(`[data-testid="keep-${character}"]`)
        .screenshot();
      assert.deepEqual(
        member,
        keep,
        `${character}: colour swap off ("keep") must look like the member`,
      );
      assert.notDeepEqual(
        member,
        shift,
        `${character}: colour swap on ("shift") must differ from the member`,
      );
    }
    await page.screenshot({
      path: `${shots}/descriptors-${theme}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, [], `${theme} descriptors page has no errors`);
    await page.close();
    console.log(
      `descriptors (${theme}): mushroom/cat/burger render, swap on/off correct`,
    );
  }
} finally {
  await browser.close();
}
console.log(`avatar S1/S2 proof passed; screenshots in ${shots}`);
