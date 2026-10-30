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
  // While the Agent works over an empty draft, the one send key is Stop.
  await page
    .locator("#root > main")
    .getByRole("button", { name: "Stop current turn" })
    .waitFor();
  assert.equal(
    await page.locator("#root > main .caps-send-action").count(),
    1,
    "the busy composer shows one key, not Stop beside Queue",
  );
  await page.getByRole("button", { name: "Send message" }).waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);

  assert.ok(
    (
      await page.locator("#root > main .parakeet-composer-row").textContent()
    )?.includes("Mistral Small 3.1 24B Instruct"),
  );
  assert.ok(
    !(
      await page.locator("#root > main .parakeet-composer-row").textContent()
    )?.includes("@cf/"),
  );
  assert.equal(
    await page.locator("#root > main .parakeet-composer-readout").textContent(),
    "300 tok · $0.00",
  );
  const settings = page.getByRole("button", {
    name: "Session settings",
    exact: true,
  });
  await settings.click();
  assert.ok(
    (await page.locator(".composer-settings").textContent())?.includes(
      "12K/200K",
    ),
  );
  await page.getByRole("button", { name: "Close tray", exact: true }).click();
  const screenshotDirectory = process.env.PARAKEET_SCREENSHOT_DIR;
  const screenshotPrefix = process.env.PARAKEET_SCREENSHOT_PREFIX;
  for (const theme of ["latte", "mocha"]) {
    const result = await page.evaluate((name) => {
      const host = globalThis.document.querySelector("main");
      if (host === null) throw new Error("composer material host is missing");
      host.dataset.theme = name;

      const queue = globalThis.document.querySelector(
        '[aria-label="Send message"]',
      );
      const textarea = globalThis.document.querySelector("textarea");
      const message = globalThis.document.querySelector(".message-body");
      const machineValue = globalThis.document.querySelector(
        "main code.font-mono",
      );
      const row = globalThis.document.querySelector(".caps-composer");
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
    assert.equal(result.disabled, true, `${theme}: empty Send is disabled`);
    const queue = page.getByRole("button", { name: "Send message" });
    const face = async (opacity) => {
      await page.waitForFunction(
        (expected) =>
          globalThis.getComputedStyle(
            globalThis.document.querySelector('[aria-label="Send message"]'),
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
    assert.equal(disabled.opacity, "0.45", `${theme}: disabled Send is dimmed`);
    assert.equal(
      await queue.evaluate((element) => element.disabled),
      true,
      `${theme}: disabled Send is natively disabled, so it cannot fire`,
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
      `${theme}: disabled Send retains its enabled key face`,
    );
    assert.ok(
      result.queueContrast >= 4.5,
      `${theme}: disabled Send contrast is ${result.queueContrast}`,
    );
    assert.equal(result.screenFont, result.messageFont);
    assert.match(result.screenFont, /Nunito/u);
    assert.match(result.machineFont, /Maple Mono/u);
    assert.doesNotMatch(result.rowClasses, /aura|rainbow/u);
    process.stdout.write(
      `${theme}: disabled Send contrast ${result.queueContrast.toFixed(2)}:1; sans interface and monospace data passed.\n`,
    );
  }

  const desktopComposer = page.getByTestId("keyboard-composer");
  const desktopTextarea = desktopComposer.locator("textarea");
  await desktopTextarea.fill("Desktop draft");
  await desktopTextarea.press("Enter");
  assert.equal(
    await desktopComposer.getByTestId("send-count").textContent(),
    "1",
  );

  const phonePage = await browser.newPage({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });
  await phonePage.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: "load",
  });
  assert.equal(
    await phonePage.evaluate(
      () => globalThis.matchMedia("(pointer: coarse)").matches,
    ),
    true,
    "touch-primary browser exposes a coarse primary pointer",
  );
  const phoneComposer = phonePage.getByTestId("keyboard-composer");
  const phoneTextarea = phoneComposer.locator("textarea");
  await phoneTextarea.fill("Half-written message");
  await phoneTextarea.press("Enter");
  assert.equal(await phoneTextarea.inputValue(), "Half-written message\n");
  assert.equal(
    await phoneComposer.getByTestId("send-count").textContent(),
    "0",
  );
  await phoneComposer.getByRole("button", { name: "Send message" }).click();
  assert.equal(
    await phoneComposer.getByTestId("send-count").textContent(),
    "1",
  );
  const imageFile = {
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1kAAAAASUVORK5CYII=",
      "base64",
    ),
  };
  await desktopComposer.locator('input[type="file"]').setInputFiles(imageFile);
  await desktopComposer
    .getByAltText("Attached image 1", { exact: true })
    .waitFor();
  const remove = desktopComposer.getByRole("button", {
    name: "Remove attached image 1",
    exact: true,
  });
  const waitForRemoveOpacity = (target, value) =>
    target.waitForFunction((expected) => {
      const button = globalThis.document.querySelector(
        '[data-testid="keyboard-composer"] .composer-attachment-remove',
      );
      return (
        button !== null &&
        globalThis.getComputedStyle(button).opacity === expected
      );
    }, value);
  for (const theme of ["latte", "mocha"]) {
    await desktopComposer.evaluate((node, name) => {
      node.dataset.theme = name;
    }, theme);
    await desktopTextarea.focus();
    await page.mouse.move(0, 0);
    await waitForRemoveOpacity(page, "0");
    await desktopComposer.locator(".composer-attachments li").hover();
    await waitForRemoveOpacity(page, "1");
    await remove.focus();
    await page.mouse.move(0, 0);
    await waitForRemoveOpacity(page, "1");
    const appearance = await remove.evaluate((node) => ({
      outline: node.classList.contains("btn-outline"),
      xs: node.classList.contains("btn-xs"),
      position: globalThis.getComputedStyle(node).position,
    }));
    assert.deepEqual(appearance, {
      outline: true,
      xs: true,
      position: "absolute",
    });
    if (screenshotDirectory)
      await desktopComposer.screenshot({
        path: resolve(
          screenshotDirectory,
          `${screenshotPrefix ?? "composer"}-attachment-${theme}.png`,
        ),
      });
  }
  await remove.click();
  assert.equal(
    await desktopComposer
      .getByAltText("Attached image 1", { exact: true })
      .count(),
    0,
  );
  await phoneComposer.locator('input[type="file"]').setInputFiles(imageFile);
  const touchRemove = phoneComposer.getByRole("button", {
    name: "Remove attached image 1",
    exact: true,
  });
  await touchRemove.waitFor();
  await waitForRemoveOpacity(phonePage, "1");
  await touchRemove.tap();
  assert.equal(
    await phoneComposer
      .getByAltText("Attached image 1", { exact: true })
      .count(),
    0,
  );
  // The native shared model key yields its label before moving edge actions.
  for (const width of [390, 1400]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page
      .locator("#root > main .parakeet-composer-row")
      .evaluate((footer) => {
        const row = footer.querySelector(".caps-status-tray-row");
        const attach = footer.querySelector(".composer-attach-key");
        const send = footer.querySelector(".composer-send-key");
        const model = footer.querySelector(".parakeet-composer-model-key");
        const readout = footer.querySelector(".parakeet-composer-readout");
        const status = footer.querySelector(".composer-status-chip");
        const attention = footer.querySelector(".composer-attention-label");
        const modelLabel = model?.querySelector(".caps-keycap-button-label");
        if (
          !row ||
          !attach ||
          !send ||
          !model ||
          !readout ||
          !status ||
          !attention ||
          !modelLabel
        )
          throw new Error("composer layout fixture is incomplete");
        const first = attach.getBoundingClientRect();
        const last = send.getBoundingClientRect();
        const bounds = row.getBoundingClientRect();
        const style = globalThis.getComputedStyle(modelLabel);
        return {
          centreDelta: Math.abs(
            first.y + first.height / 2 - last.y - last.height / 2,
          ),
          rightGap: bounds.right - last.right,
          overflows: row.scrollWidth > row.clientWidth,
          modelClipped: modelLabel.scrollWidth > modelLabel.clientWidth,
          ellipsis: style.textOverflow,
          whiteSpace: style.whiteSpace,
          readoutDisplay: globalThis.getComputedStyle(readout).display,
          statusDisplay: globalThis.getComputedStyle(status).display,
          attentionWidth: attention.getBoundingClientRect().width,
          attentionText: attention.textContent,
        };
      });
    assert.ok(
      layout.centreDelta < 1,
      `${width}px: attach and Send stay on one row: ${JSON.stringify(layout)}`,
    );
    assert.ok(
      Math.abs(layout.rightGap) < 1,
      `${width}px: Send stays at the right edge: ${JSON.stringify(layout)}`,
    );
    assert.equal(layout.overflows, false, `${width}px: footer fits its row`);
    assert.equal(layout.ellipsis, "ellipsis");
    assert.equal(layout.whiteSpace, "nowrap");
    assert.equal(layout.attentionText, "waiting for you");
    assert.ok(
      layout.attentionWidth <= 1,
      "the status dot retains its caption accessibly without visible row text",
    );
    if (width === 390) {
      assert.equal(layout.modelClipped, true, "the long model gives up width");
      assert.equal(layout.readoutDisplay, "none");
      assert.equal(layout.statusDisplay, "none");
    } else {
      assert.notEqual(layout.readoutDisplay, "none");
      assert.notEqual(layout.statusDisplay, "none");
    }
  }
  process.stdout.write(
    "desktop Enter sends; touch-primary Enter inserts a newline and Send submits; 390/1400px composer controls stay on one row.\n",
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
