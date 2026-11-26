import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { launchIsolatedChromium } from "../../../../tooling/proof-runner/isolated-chromium.mjs";
import { z } from "zod";

// A setup question card must take the keys the moment it appears (D7), over an
// empty composer or nothing focused, and the person's answer must read as
// their own message (D8). Real Chromium, at desktop and phone widths.
const packageRoot = resolve(import.meta.dirname, "../..");
const stateRoot = await mkdtemp(resolve(tmpdir(), "parakeet-question-card-"));
const bundle = resolve(stateRoot, "question-card-entry.js");
const files = new Map();
let server;
let browser;

try {
  await build({
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, "question-card-entry.tsx")],
    format: "esm",
    outfile: bundle,
    platform: "browser",
    target: "es2022",
  });
  files.set("/", {
    body: Buffer.from(
      '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/fonts.css"><main id="root"></main><script type="module" src="/question-card-entry.js"></script>',
    ),
    type: "text/html",
  });
  files.set("/question-card-entry.js", {
    body: await readFile(bundle),
    type: "text/javascript",
  });
  files.set("/styles.css", {
    body: await readFile(resolve(packageRoot, "dist/styles.css")),
    type: "text/css",
  });
  files.set("/fonts.css", {
    body: await readFile(resolve(packageRoot, "../stipe/fonts.css")),
    type: "text/css",
  });
  files.set("/fonts/Nunito-VF.ttf", {
    body: await readFile(resolve(packageRoot, "../stipe/fonts/Nunito-VF.ttf")),
    type: "font/ttf",
  });
  files.set("/fonts/MapleMono-VF.woff2", {
    body: await readFile(
      resolve(packageRoot, "../stipe/fonts/MapleMono-VF.woff2"),
    ),
    type: "font/woff2",
  });
  server = createServer((request, response) => {
    const file = files.get(
      new URL(request.url ?? "/", "http://fixture").pathname,
    );
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": `${file.type}; charset=utf-8` });
    response.end(file.body);
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const { port } = z
    .object({ port: z.number().int().nonnegative() })
    .parse(server.address());
  browser = await launchIsolatedChromium(chromium, [port]);
  const shotsDirectory = process.env.PARAKEET_SCREENSHOT_DIR;
  for (const width of [1440, 390]) {
    const open = async () => {
      const page = await browser.newPage({ viewport: { height: 900, width } });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await page.locator("textarea").waitFor();
      return page;
    };
    const card = (page) => page.getByRole("group", { name: /Agent question/u });
    const focusedRole = (page) =>
      page.evaluate(
        () => globalThis.document.activeElement?.getAttribute("role") ?? null,
      );

    const shot = async (page, name) => {
      if (shotsDirectory)
        await page.screenshot({
          path: resolve(
            shotsDirectory,
            `question-${name}-${String(width)}.png`,
          ),
        });
    };
    // The bubble that holds some text: the nearest ancestor with a painted
    // background, so a real user message and the answer can be compared.
    const bubble = (page, text) =>
      page.evaluate((needle) => {
        const doc = globalThis.document;
        const walker = doc.createTreeWalker(doc.body, 4);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim() !== needle) continue;
          for (let el = node.parentElement; el; el = el.parentElement) {
            const style = globalThis.getComputedStyle(el);
            if (
              style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
              style.borderLeftWidth !== "0px"
            )
              return {
                background: style.backgroundColor,
                borderLeft: style.borderLeftWidth,
                top: el.getBoundingClientRect().top,
                fontSize: globalThis.getComputedStyle(node.parentElement)
                  .fontSize,
              };
          }
        }
        return null;
      }, text);

    // The real sequence: the Agent's turn, the card, nothing picked by focus,
    // then a pick and Send, after which the answer is the newest user message.
    {
      const page = await open();
      await page.getByText("First I would like to know").waitFor();
      assert.equal(
        await page.getByText("Ran script").count(),
        1,
        `${width}px: the call shows while the ask is open`,
      );
      await page.evaluate(() => {
        globalThis.document.activeElement?.blur();
        globalThis.setAsking(true);
      });
      await card(page).waitFor();
      await shot(page, "1-card-open");
      // D7: the list has the keys, and focus is not a selection.
      assert.equal(
        await focusedRole(page),
        "listbox",
        `${width}px: list has focus`,
      );
      assert.equal(
        await card(page).locator("[data-highlight]").count(),
        0,
        `${width}px: no row is highlighted by focus`,
      );
      assert.equal(
        await card(page)
          .locator('[role="option"][aria-selected="true"]')
          .count(),
        0,
        `${width}px: no row reads as chosen`,
      );
      // Enter and Space with nothing highlighted do nothing.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);
      assert.equal(
        await card(page).count(),
        1,
        `${width}px: the card is still open`,
      );
      assert.equal(
        await page.getByText("Explore together", { exact: true }).count(),
        0,
        `${width}px: nothing was sent`,
      );
      // The first arrow highlights row 1; j does the same from nothing.
      await page.keyboard.press("ArrowDown");
      assert.match(
        await card(page).locator("[data-highlight]").innerText(),
        /Explore together/u,
        `${width}px: the first arrow highlights the first row`,
      );
      await shot(page, "2-first-row-highlighted");
      await page.keyboard.press("Enter");
      // The card closes and the answer is the newest user message.
      await card(page).waitFor({ state: "detached" });
      const answer = page.getByText("Explore together", { exact: true });
      await answer.waitFor();
      await shot(page, "3-answered");
      assert.equal(
        await page.getByText("Ran script").count(),
        0,
        `${width}px: the answered question leaves no code row behind`,
      );
      assert.equal(
        await answer.count(),
        1,
        `${width}px: the answer appears once`,
      );
      const mine = await bubble(page, "Set me up");
      const theirs = await bubble(page, "Explore together");
      assert.ok(mine && theirs, `${width}px: both are drawn as bubbles`);
      assert.equal(
        theirs.background,
        mine.background,
        `${width}px: same bubble as a typed message`,
      );
      assert.equal(
        theirs.borderLeft,
        mine.borderLeft,
        `${width}px: same edge as a typed message`,
      );
      assert.equal(
        theirs.fontSize,
        mine.fontSize,
        `${width}px: same text size`,
      );
      assert.ok(
        theirs.top > mine.top,
        `${width}px: the answer is below the first message`,
      );
      await page.close();
    }

    // The empty conversation's prompt is body size, not a 10px whisper.
    {
      const page = await browser.newPage({ viewport: { height: 900, width } });
      await page.goto(`http://127.0.0.1:${port}/?empty`, { waitUntil: "load" });
      const prompt = page.getByText("What would you like to build?");
      await prompt.waitFor();
      const size = await prompt.evaluate((el) =>
        Number.parseFloat(globalThis.getComputedStyle(el).fontSize),
      );
      assert.ok(size >= 14, `${width}px: the empty prompt is ${size}px`);
      // Centred in the conversation area, not in one half of it.
      const centres = await prompt.evaluate((el) => {
        // The pane is the whole conversation column, not the reading width.
        const scroller = el.closest(".parakeet");
        const at = (box) => box.left + box.width / 2;
        return {
          prompt: at(el.getBoundingClientRect()),
          scroller: at(scroller.getBoundingClientRect()),
          scrollerWidth: scroller.getBoundingClientRect().width,
        };
      });
      assert.ok(
        Math.abs(centres.prompt - centres.scroller) <= 8,
        `${width}px: the empty prompt is centred in the pane: ${JSON.stringify(centres)}`,
      );
      await shot(page, "4-empty-state");
      await page.close();
    }

    // D7: an empty composer that has the caret hands it to the card.
    {
      const page = await open();
      await page.locator("textarea").focus();
      await page.evaluate(() => globalThis.setAsking(true));
      await card(page).waitFor();
      assert.equal(
        await focusedRole(page),
        "listbox",
        `${width}px: empty field hands over`,
      );
      await page.close();
    }

    // D7: never steal focus while someone is typing.
    {
      const page = await open();
      await page.locator("textarea").focus();
      await page.keyboard.type("hel");
      await page.evaluate(() => globalThis.setAsking(true));
      await card(page).waitFor();
      assert.equal(
        await page.evaluate(() => globalThis.document.activeElement?.tagName),
        "TEXTAREA",
        `${width}px: the caret stays with the typist`,
      );
      assert.equal(await page.locator("textarea").inputValue(), "hel");
      await page.close();
    }
  }
  process.stdout.write(
    "a setup question takes the keys at once over an empty or unfocused composer, never over typing, and its answer reads as the person's own message at 1440/390px.\n",
  );
} finally {
  if (browser) await browser.close();
  if (server?.listening)
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) =>
        error === undefined ? resolveClose() : rejectClose(error),
      );
    });
  await rm(stateRoot, { recursive: true, force: true });
}
