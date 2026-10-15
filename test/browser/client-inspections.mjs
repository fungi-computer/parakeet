import process from "node:process";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { chromium } from "playwright";
import * as z from "zod";
const packageRoot = resolve(import.meta.dirname, "../..");
const state = await mkdtemp(resolve(tmpdir(), "parakeet-inspection-"));
const bundle = resolve(state, "entry.js");
let server;
let browser;
try {
  await build({
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, "client-inspection-entry.tsx")],
    format: "esm",
    outfile: bundle,
    platform: "browser",
    target: "es2022",
    plugins:
      process.env.PARAKEET_INSPECTION_BEFORE_SOURCE === undefined
        ? []
        : [
            {
              name: "retained-browser-renderer",
              setup(plugin) {
                plugin.onLoad(
                  { filter: /\/components\/ClientRows\.tsx$/ },
                  async (args) => ({
                    contents: await readFile(
                      process.env.PARAKEET_INSPECTION_BEFORE_SOURCE,
                      "utf8",
                    ),
                    loader: "tsx",
                    resolveDir: dirname(args.path),
                  }),
                );
              },
            },
          ],
  });
  const files = new Map([
    [
      "/",
      {
        type: "text/html",
        body: Buffer.from(
          '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/fonts.css"><main id="root"></main><script type="module" src="/entry.js"></script>',
        ),
      },
    ],
    ["/entry.js", { type: "text/javascript", body: await readFile(bundle) }],
    [
      "/styles.css",
      {
        type: "text/css",
        body: await readFile(resolve(packageRoot, "dist/styles.css")),
      },
    ],
    [
      "/fonts.css",
      {
        type: "text/css",
        body: await readFile(resolve(packageRoot, "../stipe/fonts.css")),
      },
    ],
    [
      "/fonts/Nunito-VF.ttf",
      {
        type: "font/ttf",
        body: await readFile(
          resolve(packageRoot, "../stipe/fonts/Nunito-VF.ttf"),
        ),
      },
    ],
    [
      "/fonts/MapleMono-VF.woff2",
      {
        type: "font/woff2",
        body: await readFile(
          resolve(packageRoot, "../stipe/fonts/MapleMono-VF.woff2"),
        ),
      },
    ],
  ]);
  server = createServer((request, response) => {
    const file = files.get(request.url ?? "");
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": file.type });
    response.end(file.body);
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const { port } = z.object({ port: z.number() }).parse(server.address());
  browser = await chromium.launch({ headless: true });
  const errors = [];
  const directory = process.env.PARAKEET_INSPECTION_CAPTURE_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  for (const width of [1440, 390])
    for (const theme of ["latte", "mocha"]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await page.locator('[data-client-row="summary"]').waitFor();
      await page.evaluate((name) => {
        globalThis.document.documentElement.dataset.theme = name;
      }, theme);
      await page.evaluate(() => globalThis.document.fonts.ready);
      assert.equal(await page.locator("[data-client-inspection]").count(), 0);
      const composer = page.locator("textarea");
      await composer.fill("/inspect");
      await composer.press("Enter");
      if (process.env.PARAKEET_INSPECTION_BASELINE !== "1") {
        await page.locator("[data-client-inspection]").waitFor();
        assert.equal(
          await page
            .locator('[data-client-inspection] [data-glyph="dot"]')
            .count(),
          5,
        );
        assert.equal(
          await page
            .locator("[data-client-inspection]")
            .getByText("Trace the owner")
            .count(),
          1,
        );
      } else await page.waitForTimeout(100);
      assert.ok(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        `overflow at ${width}`,
      );
      if (directory)
        await page.screenshot({
          path: resolve(directory, `${width}-${theme}.png`),
        });
      if (process.env.PARAKEET_INSPECTION_BASELINE !== "1") {
        await page
          .locator("[data-client-inspection]")
          .getByRole("button", { name: "Close" })
          .click();
        assert.equal(await page.locator("[data-client-inspection]").count(), 0);
      }
      await page.close();
    }
  assert.deepEqual(errors, []);
  process.stdout.write(
    "PASS browser inspection 1440/390 light/dark, real advertised door, bounded footer, dots, close\n",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(state, { recursive: true, force: true });
}
