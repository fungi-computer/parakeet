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
  const page = await browser.newPage({
    viewport: { height: 900, width: 1440 },
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  const card = page.getByRole("group", { name: /Agent approval/u });
  await card.waitFor();
  const options = await card.getByRole("option").allInnerTexts();
  assert.equal(options.length, 4, `four rows, got ${JSON.stringify(options)}`);
  assert.match(options[2] ?? "", /Deny$/u, "the third row is Deny");
  // A person clicks "3. Deny" with the mouse, then presses Send.
  await card.getByRole("option", { name: /Deny$/u }).first().click();
  // The same record is refreshed between the click and Send.
  await page.evaluate(() => {
    globalThis.refreshCard();
    globalThis.refreshCard();
  });
  await page.waitForFunction(
    () => globalThis.document.querySelector("[data-renders='2']") !== null,
  );
  const selected = await card
    .locator('[role="option"][aria-selected="true"]')
    .allInnerTexts();
  await card.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => globalThis.decisionAnswers.length > 0);
  const [answer] = await page.evaluate(() => globalThis.decisionAnswers);
  assert.deepEqual(
    answer.selected,
    ["deny"],
    `clicking Deny answers deny (selected before Send: ${JSON.stringify(selected)})`,
  );
  log("decision click proof passed: Deny answers deny");
} finally {
  await browser?.close();
  server?.close();
  await rm(stateRoot, { recursive: true, force: true });
}
