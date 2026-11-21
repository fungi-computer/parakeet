import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { log } from "node:console";
import { build } from "esbuild";
import { chromium } from "playwright";
import { launchIsolatedChromium } from "../../../../tooling/proof-runner/isolated-chromium.mjs";
import { z } from "zod";

const packageRoot = resolve(import.meta.dirname, "../..");
const stateRoot = await mkdtemp(resolve(tmpdir(), "parakeet-decision-click-"));
const bundle = resolve(stateRoot, "decision-click-entry.js");
const files = new Map();
let server;
let browser;

try {
  await build({
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, "decision-click-entry.tsx")],
    format: "esm",
    outfile: bundle,
    platform: "browser",
    target: "es2022",
  });

  files.set("/", {
    body: Buffer.from(
      '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/fonts.css"><main id="root"></main><script type="module" src="/decision-click-entry.js"></script>',
    ),
    type: "text/html",
  });
  files.set("/decision-click-entry.js", {
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
    const file = files.get(request.url ?? "");
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": `${file.type}; charset=utf-8`,
    });
    response.end(file.body);
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = z
    .object({
      address: z.string(),
      family: z.string(),
      port: z.number().int().nonnegative(),
    })
    .parse(server.address());

  browser = await launchIsolatedChromium(chromium, [address.port]);
  const gaps = {
    "an unmounted owner": async (page) => {
      await page.evaluate(() => globalThis.setOwned(false));
      await page.evaluate(() => globalThis.setOwned(true));
    },
    "a right that flips off then on": async (page) => {
      await page.evaluate(() => globalThis.setAnswerable(false));
      await page.evaluate(() => globalThis.setAnswerable(true));
    },
    "access revoked then restored": async (page) => {
      await page.evaluate(() => {
        globalThis.setAnswerable(false);
        globalThis.setOwned(false);
      });
      await page.evaluate(() => {
        globalThis.setOwned(true);
        globalThis.setAnswerable(true);
      });
    },
  };
  for (const width of [1280, 390]) {
    for (const input of ["pointer", "keyboard"]) {
      const open = async () => {
        const page = await browser.newPage({
          viewport: { height: 900, width },
        });
        await page.goto(`http://127.0.0.1:${address.port}/`, {
          waitUntil: "load",
        });
        const card = page.getByRole("group", { name: /Agent approval/u });
        await card.waitFor();
        return { page, card };
      };
      const send = async (page, card) => {
        if (input === "pointer")
          await card.getByRole("button", { name: "Send", exact: true }).click();
        else {
          await card.getByRole("listbox").focus();
          await page.keyboard.press("Enter");
        }
      };
      const selected = (card) =>
        card.locator('[role="option"][aria-selected="true"]').allInnerTexts();

      // No card, fresh or redrawn, preselects a choice.
      {
        const { page, card } = await open();
        const options = await card.getByRole("option").allInnerTexts();
        assert.equal(
          options.length,
          4,
          `four rows, got ${JSON.stringify(options)}`,
        );
        assert.match(options[2] ?? "", /Deny$/u, "the third row is Deny");
        assert.match(options[0] ?? "", /Approve once \(recommended\)/u);
        assert.deepEqual(
          await selected(card),
          [],
          `${width} ${input}: a fresh card has nothing selected`,
        );
        assert.equal(
          await card
            .getByRole("button", { name: "Send", exact: true })
            .isDisabled(),
          true,
          `${width} ${input}: Send is disabled on a fresh card`,
        );
        await card.getByRole("listbox").focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
        assert.equal(
          (await page.evaluate(() => globalThis.decisionAnswers)).length,
          0,
          `${width} ${input}: Enter answers nothing on a fresh card`,
        );
        await page.close();
      }

      for (const [gap, cross] of Object.entries(gaps)) {
        const { page, card } = await open();
        const deny = card.getByRole("option", { name: /Deny$/u });
        if (input === "pointer") await deny.click();
        else {
          await card.getByRole("listbox").focus();
          await page.keyboard.press("3");
        }
        await page.evaluate(() => {
          globalThis.refreshCard();
          globalThis.refreshCard();
        });
        await cross(page);
        await card.waitFor();
        const after = await selected(card);
        assert.ok(
          after.length === 1 && (after[0] ?? "").endsWith("Deny"),
          `${width} ${input} ${gap}: Deny survives, got ${JSON.stringify(after)}`,
        );
        await send(page, card);
        await page.waitForFunction(() => globalThis.decisionAnswers.length > 0);
        const [answer] = await page.evaluate(() => globalThis.decisionAnswers);
        assert.equal(answer.decision, "deny", `${width} ${input} ${gap}`);
        log(
          `decision proof passed: ${width} ${input} records deny after ${gap}`,
        );
        await page.close();
      }

      // A gap with no remembered choice starts with nothing selected.
      for (const [gap, cross] of Object.entries(gaps)) {
        const { page, card } = await open();
        await cross(page);
        await card.waitFor();
        assert.deepEqual(
          await selected(card),
          [],
          `${width} ${input} ${gap}: nothing is preselected`,
        );
        assert.equal(
          await card
            .getByRole("button", { name: "Send", exact: true })
            .isDisabled(),
          true,
          `${width} ${input} ${gap}: Send is disabled`,
        );
        await card.getByRole("listbox").focus();
        await page.keyboard.press("Enter");
        await page.waitForTimeout(150);
        assert.equal(
          (await page.evaluate(() => globalThis.decisionAnswers)).length,
          0,
          `${width} ${input} ${gap}: Enter answers nothing`,
        );
        // An explicit choice is then answerable.
        await card.getByRole("option", { name: /Deny$/u }).click();
        await send(page, card);
        await page.waitForFunction(() => globalThis.decisionAnswers.length > 0);
        log(
          `decision proof passed: ${width} ${input} nothing selected after ${gap}`,
        );
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  server?.close();
  await rm(stateRoot, { recursive: true, force: true });
}
