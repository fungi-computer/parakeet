import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";
import { chromium } from "playwright";
import { z } from "zod";

const packageRoot = resolve(import.meta.dirname, "../..");
const stateRoot = await mkdtemp(
  resolve(tmpdir(), "parakeet-composer-materials-"),
);
const bundle = resolve(stateRoot, "composer-material-entry.js");
const files = new Map();
let server;
let browser;

try {
  await build({
    bundle: true,
    entryPoints: [resolve(import.meta.dirname, "composer-material-entry.tsx")],
    format: "esm",
    outfile: bundle,
    platform: "browser",
    target: "es2022",
  });

  files.set("/", {
    body: Buffer.from(
      '<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/fonts.css"><main id="root"></main><script type="module" src="/composer-material-entry.js"></script>',
    ),
    type: "text/html",
  });
  files.set("/composer-material-entry.js", {
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

  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: {
      height: 900,
      width: z.coerce
        .number()
        .int()
        .positive()
        .max(3840)
        .parse(process.env.PARAKEET_SCREENSHOT_WIDTH ?? 1440),
    },
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: "load",
  });
  await page.getByRole("button", { name: "Queue follow-up" }).waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);

  assert.ok(
    (await page.locator(".composer-footer").textContent())?.includes(
      "openai/gpt-6-astra",
    ),
  );
  assert.ok(
    !(await page.locator(".composer-footer").textContent())?.includes(
      "@openai",
    ),
  );
  assert.ok(
    (await page.locator(".composer-footer").textContent())?.includes(
      "openai/gpt-6-astra12K/200K",
    ),
  );
  const screenshotDirectory = process.env.PARAKEET_SCREENSHOT_DIR;
  const screenshotPrefix = process.env.PARAKEET_SCREENSHOT_PREFIX;
  for (const theme of ["latte", "mocha"]) {
    const result = await page.evaluate((name) => {
      const host = globalThis.document.querySelector("main");
      if (host === null) throw new Error("composer material host is missing");
      host.dataset.theme = name;

      const queue = globalThis.document.querySelector(
        '[aria-label="Queue follow-up"]',
      );
      const textarea = globalThis.document.querySelector("textarea");
      const message = globalThis.document.querySelector(".message-body");
      const machineValue = globalThis.document.querySelector(
        "main code.font-mono",
      );
      const row = globalThis.document.querySelector(".caps-composer > .join");
      if (!queue || !textarea || !message || !machineValue || !row)
        throw new Error("composer material fixture is incomplete");

      const canvas = globalThis.document
        .createElement("canvas")
        .getContext("2d");
      if (canvas === null) throw new Error("canvas context is unavailable");
      const luminance = (color) => {
        canvas.fillStyle = color;
        canvas.fillRect(0, 0, 1, 1);
        const [red, green, blue] = [...canvas.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          });
        return red * 0.2126 + green * 0.7152 + blue * 0.0722;
      };
      const buttonStyle = globalThis.getComputedStyle(queue);
      const foreground = luminance(buttonStyle.color);
      const background = luminance(buttonStyle.backgroundColor);
      const screenFont = globalThis.getComputedStyle(
        globalThis.document.querySelector(".caps-screen") ?? message,
      ).fontFamily;
      const sansFont = globalThis
        .getComputedStyle(host)
        .getPropertyValue("--font-sans");
      return {
        disabled: queue.disabled,
        queueOpacity: buttonStyle.opacity,
        queueContrast:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
        screenFont,
        messageFont: globalThis.getComputedStyle(message).fontFamily,
        sansFont: sansFont.trim(),
        machineFont: globalThis.getComputedStyle(machineValue).fontFamily,
        rowClasses: row.className,
        rowShadow: globalThis.getComputedStyle(row).boxShadow,
        shellShadow: globalThis.getComputedStyle(
          globalThis.document.querySelector(".caps-composer > .join")
            ?.parentElement,
        ).boxShadow,
        theme: host.dataset.theme,
      };
    }, theme);

    if (screenshotDirectory && screenshotPrefix) {
      await page.screenshot({
        path: resolve(
          screenshotDirectory,
          `${screenshotPrefix}-composer-${theme}.png`,
        ),
        fullPage: true,
      });
    }

    assert.equal(result.theme, theme);
    assert.equal(result.disabled, true, `${theme}: Queue is disabled`);
    const queue = page.getByRole("button", { name: "Queue follow-up" });
    const face = async (opacity) => {
      await page.waitForFunction(
        (expected) =>
          globalThis.getComputedStyle(
            globalThis.document.querySelector('[aria-label="Queue follow-up"]'),
          ).opacity === expected,
        opacity,
      );
      return queue.evaluate(async (element) => {
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished),
        );
        const style = globalThis.getComputedStyle(element);
        return {
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
          face: {
            background: style.backgroundColor,
            image: style.backgroundImage,
            color: style.color,
            border: [
              style.borderTop,
              style.borderRight,
              style.borderBottom,
              style.borderLeft,
            ],
            radius: style.borderRadius,
            outline: `${style.outlineWidth} ${style.outlineStyle}`,
            shadow: style.boxShadow,
            cut: style.clipPath,
          },
        };
      });
    };
    const disabled = await face("0.45");
    assert.equal(
      disabled.opacity,
      "0.45",
      `${theme}: disabled Queue is dimmed`,
    );
    assert.equal(
      disabled.pointerEvents,
      "none",
      `${theme}: Queue blocks pointers`,
    );
    await queue.evaluate((element) => {
      element.disabled = false;
    });
    const enabled = await face("1");
    await queue.evaluate((element) => {
      element.disabled = true;
    });
    await face("0.45");
    assert.deepEqual(
      disabled.face,
      enabled.face,
      `${theme}: disabled Queue retains its enabled filled face`,
    );
    assert.ok(
      result.queueContrast >= 4.5,
      `${theme}: disabled Queue contrast is ${result.queueContrast}`,
    );
    assert.equal(result.screenFont, result.messageFont);
    assert.match(result.screenFont, /Nunito/u);
    assert.match(result.machineFont, /Maple Mono/u);
    assert.doesNotMatch(result.rowClasses, /aura|rainbow/u);
    process.stdout.write(
      `${theme}: disabled Queue contrast ${result.queueContrast.toFixed(2)}:1; sans interface and monospace data passed.\n`,
    );
  }
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
