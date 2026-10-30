import { build } from "esbuild";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { z } from "zod";

const packageRoot = resolve(import.meta.dirname, "../..");
const entry = resolve(import.meta.dirname, "browser-entry.tsx");
const stateRoot = await mkdtemp(resolve(tmpdir(), "parakeet-browser-"));
const bundle = resolve(stateRoot, "browser-entry.js");
const stylesheet = resolve(packageRoot, "dist/styles.css");
const screenshot = resolve(
  packageRoot,
  "../../.botanical/parakeet-browser-proof.png",
);
const html = `<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}</style><link rel="stylesheet" href="/styles.css"><main id="root"></main><script type="module" src="/${basename(bundle)}"></script>`;

let server;
let browser;
let page;
const pageErrors = [];

try {
  await build({
    bundle: true,
    entryPoints: [entry],
    format: "esm",
    outfile: bundle,
    platform: "browser",
    target: "es2022",
  });
  await writeFile(resolve(stateRoot, "index.html"), html);

  server = createServer(async (request, response) => {
    const file =
      request.url === "/"
        ? resolve(stateRoot, "index.html")
        : request.url === `/${basename(bundle)}`
          ? bundle
          : request.url === "/styles.css"
            ? stylesheet
            : undefined;
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    const contentType = file.endsWith(".css")
      ? "text/css"
      : file.endsWith(".js")
        ? "text/javascript"
        : "text/html";
    response.writeHead(200, {
      "content-type": `${contentType}; charset=utf-8`,
    });
    response.end(await readFile(file));
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

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({
    viewport: { height: 1_000, width: 1_134 },
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });

  await page.waitForFunction(() => {
    const scroller = globalThis.document.querySelector("[data-chat-scroller]");
    return (
      scroller !== null && scroller.scrollHeight > scroller.clientHeight + 1
    );
  });
  await page.waitForTimeout(100);
  const initialDistanceFromBottom = await page
    .locator("[data-chat-scroller]")
    .evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  assert.ok(
    initialDistanceFromBottom <= 1,
    `loaded conversation started ${String(initialDistanceFromBottom)}px from its latest message`,
  );

  await page.locator("[data-chat-scroller]").evaluate((node) => {
    node.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Jump to bottom" }).waitFor();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  const awayState = await page
    .locator("[data-chat-scroller]")
    .evaluate((node) => ({ height: node.scrollHeight, top: node.scrollTop }));
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.receiveRemotePrompt(),
  );
  await page.waitForFunction((previousHeight) => {
    const scroller = globalThis.document.querySelector("[data-chat-scroller]");
    return scroller !== null && scroller.scrollHeight > previousHeight;
  }, awayState.height);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  const afterRemotePrompt = await page
    .locator("[data-chat-scroller]")
    .evaluate((node) => ({ height: node.scrollHeight, top: node.scrollTop }));
  assert.equal(
    afterRemotePrompt.top,
    awayState.top,
    "a remote user row pulled an away reader to the bottom",
  );
  assert.ok(
    afterRemotePrompt.height >= awayState.height,
    "remote user row reduced the virtualized conversation height",
  );
  await page.getByRole("button", { name: "Jump to bottom" }).click();
  await page.waitForFunction(() => {
    const scroller = globalThis.document.querySelector("[data-chat-scroller]");
    return (
      scroller !== null &&
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 1
    );
  });

  const goalPanel = page.getByRole("region", {
    name: "Session extension controls",
  });
  await goalPanel.waitFor();
  assert.ok(
    (await goalPanel.boundingBox()).height <= 34,
    "closed goal controls exceed the retained 32px row plus border",
  );
  await goalPanel.locator("summary").click();
  assert.equal(await goalPanel.locator("details").getAttribute("open"), "");
  assert.equal(await goalPanel.locator("p").isVisible(), true);
  await goalPanel.locator("summary").click();
  assert.ok(
    (await goalPanel.textContent()).includes("Make browser goals useful"),
  );
  await goalPanel.getByRole("button", { name: "Pause goal" }).click();
  await goalPanel.getByRole("button", { name: "Resume goal" }).waitFor();
  await goalPanel.getByRole("button", { name: "Resume goal" }).click();
  await goalPanel.getByRole("alert").waitFor();
  assert.match(
    await goalPanel.getByRole("alert").textContent(),
    /Resume temporarily rejected/u,
  );
  await goalPanel.getByRole("button", { name: "Resume goal" }).click();
  await goalPanel.getByRole("button", { name: "Pause goal" }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      pauses: globalThis.__parakeetBrowserProof.pauses,
      resumes: globalThis.__parakeetBrowserProof.resumes,
      aborts: globalThis.__parakeetBrowserProof.aborts,
    })),
    { pauses: 1, resumes: 2, aborts: 0 },
  );
  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot.replace(".png", "-goals.png") });

  const textarea = page.locator("textarea");
  await textarea.waitFor();
  const composerGeometry = await textarea.evaluate((node) => {
    const wrapper = node.closest(".caps-composer");
    const input = node.closest(".caps-composer-input");
    const bar = wrapper?.querySelector(".caps-composer-bar");
    const action = bar?.querySelector(".caps-send-action");
    if (!wrapper || !input || !bar || !action)
      throw new Error("native composer field and action are missing");
    const textareaStyle = globalThis.getComputedStyle(node);
    const wrapperStyle = globalThis.getComputedStyle(wrapper);
    const inputBounds = input.getBoundingClientRect();
    const wrapperBounds = wrapper.getBoundingClientRect();
    const nativeRow = action.closest(".caps-status-tray-row");
    const rowBounds = (nativeRow ?? bar).getBoundingClientRect();
    const actionBounds = action.getBoundingClientRect();
    return {
      minHeight: textareaStyle.minHeight,
      wrapperDirection: wrapperStyle.flexDirection,
      wrapperDisplay: wrapperStyle.display,
      wrapperMinWidth: wrapperStyle.minWidth,
      fieldWidthDelta: Math.abs(inputBounds.width - wrapperBounds.width),
      rowRightInset: wrapperBounds.right - rowBounds.right,
      expectedRowInset: nativeRow === null ? 0 : 4,
      actionRightGap: rowBounds.right - actionBounds.right,
      actionCentreDelta: Math.abs(
        rowBounds.y +
          rowBounds.height / 2 -
          actionBounds.y -
          actionBounds.height / 2,
      ),
      actionBelowField: actionBounds.top >= inputBounds.bottom,
    };
  });
  // Caps owns a column of slots, not the retired inline field/action flex row.
  // Prove the caller-visible alignment: full-width field, then the centred
  // action at the bottom row's content edge (the shared tray has 4px padding).
  if (
    composerGeometry.minHeight !== "48px" ||
    composerGeometry.wrapperDirection !== "column" ||
    composerGeometry.wrapperDisplay !== "flex" ||
    composerGeometry.wrapperMinWidth !== "0px" ||
    composerGeometry.fieldWidthDelta > 1 ||
    Math.abs(
      composerGeometry.rowRightInset - composerGeometry.expectedRowInset,
    ) > 1 ||
    Math.abs(composerGeometry.actionRightGap) > 1 ||
    composerGeometry.actionCentreDelta > 1 ||
    !composerGeometry.actionBelowField
  )
    throw new Error(
      `composer geometry changed: ${JSON.stringify(composerGeometry)}`,
    );
  const label = page.getByText("Message", { exact: true });
  if ((await label.getAttribute("for")) !== (await textarea.getAttribute("id")))
    throw new Error("composer label is not associated with its textarea");
  if ((await textarea.getAttribute("rows")) !== "1")
    throw new Error("composer did not retain its one-row geometry");

  await textarea.fill("Browser prompt");
  await textarea.press("Enter");
  const rejected = page.locator(
    '[data-parakeet-entry="user"][data-status="failed"]',
  );
  await rejected.waitFor();
  if (!(await rejected.textContent())?.includes("Browser prompt"))
    throw new Error("rejected prompt content was not retained");
  const alert = page.locator(".chat-composer [role=alert]");
  await alert.waitFor();
  if (
    !(await textarea.evaluate(
      (node) => node === node.ownerDocument.activeElement,
    ))
  )
    throw new Error("typed failure did not restore composer focus");
  if (
    !(await alert.textContent())?.includes(
      "Your prompt didn’t make it through.",
    )
  )
    throw new Error(
      `admission copy is inaccurate: ${await alert.textContent()}`,
    );
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "latte";
  });
  await page.screenshot({ path: screenshot.replace(".png", "-admission.png") });

  await alert.getByRole("button", { name: "Retry prompt" }).click();
  const confirmed = page.locator(
    '[data-parakeet-id="browser-user"][data-status="confirmed"]',
  );
  await confirmed.waitFor();
  if ((await page.locator('[data-parakeet-id="browser-user"]').count()) !== 1)
    throw new Error("accepted prompt duplicated its optimistic row");
  if (
    (await confirmed.locator(".message-body").textContent()) !==
    "Browser prompt"
  )
    throw new Error("accepted prompt rendered the wrong content");

  const thinking = page.getByRole("button", { name: "Thoughts" });
  await thinking.waitFor();
  if ((await thinking.getAttribute("aria-expanded")) !== "false")
    throw new Error("Thinking disclosure was not collapsed initially");
  await thinking.click();
  if (!(await page.locator("body").textContent())?.includes("checking"))
    throw new Error("Thinking disclosure did not reveal retained content");

  const cancel = page.getByRole("button", { name: "Stop current turn" });
  await cancel.waitFor();
  if ((await cancel.getAttribute("aria-disabled")) !== null)
    throw new Error(
      "busy composer action became a disabled translucent button",
    );

  await page.evaluate(() => globalThis.__parakeetBrowserProof.complete());
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.terminateLatestRun("failed"),
  );
  const runFailure = page.locator(".chat-composer [role=alert]");
  await runFailure.waitFor();
  if (
    !(await runFailure.textContent())?.includes(
      "The run stopped. Check the message above before trying again.",
    )
  )
    throw new Error(
      `run failure copy is inaccurate: ${await runFailure.textContent()}`,
    );
  await page.screenshot({
    path: screenshot.replace(".png", "-run-failed.png"),
  });
  await textarea.fill("A new prompt after failure");
  await textarea.press("Enter");
  await page
    .locator('[data-parakeet-id="browser-user-3"][data-status="confirmed"]')
    .waitFor();
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.terminateLatestRun("cancelled"),
  );
  await runFailure.getByText(/The run was cancelled\./u).waitFor();
  if (!(await runFailure.textContent())?.includes("The run was cancelled."))
    throw new Error(
      `cancellation copy is inaccurate: ${await runFailure.textContent()}`,
    );
  await page.screenshot({ path: screenshot.replace(".png", "-cancelled.png") });

  const assertMarkdownFence = async (width) => {
    await page.setViewportSize({ height: 1_000, width });
    const message = page.locator('[data-parakeet-id="browser-assistant"]');
    await message.waitFor();
    const fence = message.locator("pre");
    await fence.waitFor();
    assert.deepEqual(
      await fence.evaluate((node) => ({
        filename: node.getAttribute("data-filename"),
        language: node.getAttribute("data-lang"),
        title: node.getAttribute("data-code-title"),
      })),
      { filename: "proof.ts", language: "ts", title: "proof.ts" },
      "titled TypeScript fence lost producer metadata at " +
        String(width) +
        "px",
    );
    const fenceClasses = new Set(
      (await fence.getAttribute("class"))?.split(/\s+/u),
    );
    assert.deepEqual(
      {
        breakWords: fenceClasses.has("break-words"),
        producer: fenceClasses.has("tm-code"),
        wrapping: fenceClasses.has("whitespace-pre-wrap"),
      },
      { breakWords: true, producer: true, wrapping: true },
      "Markdown fence lost producer or wrapping classes at " +
        String(width) +
        "px",
    );
    assert.ok(
      (await fence.locator(".th-keyword").count()) > 0,
      "TypeScript keyword highlighting missing at " + String(width) + "px",
    );
    assert.ok(
      (await fence.locator(".th-number").count()) > 0,
      "TypeScript number highlighting missing at " + String(width) + "px",
    );
    const messageText = await message.textContent();
    assert.deepEqual(
      {
        escaped: messageText?.includes("*escaped Markdown proof*"),
        plain: messageText?.includes("Plain Markdown proof."),
        betweenRules: messageText?.includes("Conversation text between rules."),
      },
      { escaped: true, plain: true, betweenRules: true },
      "plain or escaped Markdown changed at " + String(width) + "px",
    );
    const pageOverflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    );
    assert.ok(
      pageOverflow <= 1,
      "Markdown fence caused " +
        String(pageOverflow) +
        "px page overflow at " +
        String(width) +
        "px",
    );
  };
  await assertMarkdownFence(1_134);
  await assertMarkdownFence(320);

  // Highlight tokens follow the nearest palette, including nested panels.
  const highlightedMessage = page.locator(
    '[data-parakeet-id="browser-assistant"]',
  );
  const syntaxColors = () =>
    highlightedMessage
      .locator(".th-keyword, .th-number")
      .evaluateAll((tokens) =>
        tokens.map((token) => globalThis.getComputedStyle(token).color),
      );
  for (const theme of ["latte", "mocha"]) {
    await page.evaluate((name) => {
      globalThis.document.documentElement.dataset.theme = name;
    }, theme);
    await highlightedMessage.evaluate((message) =>
      message.removeAttribute("data-theme"),
    );
    const rootColors = await syntaxColors();
    await highlightedMessage.evaluate((message, name) => {
      message.setAttribute("data-theme", name);
    }, theme);
    await page.evaluate((name) => {
      globalThis.document.documentElement.dataset.theme =
        name === "latte" ? "mocha" : "latte";
    }, theme);
    assert.deepEqual(
      await syntaxColors(),
      rootColors,
      `${theme}: nested syntax matches its root palette`,
    );
    await highlightedMessage.locator("pre").screenshot({
      path: screenshot.replace(".png", `-syntax-${theme}.png`),
    });
  }
  await highlightedMessage.evaluate((message) =>
    message.removeAttribute("data-theme"),
  );
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.theme = "latte";
  });

  const tool = page.locator('[data-parakeet-entry="tool_group"]');
  await tool.waitFor();
  const toolHeader = tool.locator("button[aria-expanded]").first();
  if ((await toolHeader.getAttribute("aria-expanded")) !== "false")
    throw new Error("a finished tool group must start collapsed");
  await toolHeader.focus();
  await page.keyboard.press("Enter");
  if ((await toolHeader.getAttribute("aria-expanded")) !== "true")
    throw new Error("Enter did not expand the tool group");
  const toolText = await tool.textContent();
  if (
    !toolText?.includes("Ran script") ||
    /result\.(?:content|stdout)|Arguments|truncated/u.test(toolText) ||
    !toolText.includes("computer.read") ||
    !toolText.includes("read complete")
  )
    throw new Error(`tool result is incomplete: ${toolText}`);
  if (!(await tool.locator('[data-parakeet-section="script"]').count()))
    throw new Error("script source is not shown before its output");
  if (!(await tool.locator(".caps-status .text-success").count()))
    throw new Error("completed tool does not expose Caps success status");

  const stylesheetLoaded = await page.evaluate(() =>
    Array.from(globalThis.document.styleSheets).some(
      (sheet) =>
        sheet.href?.endsWith("/styles.css") && sheet.cssRules.length > 0,
    ),
  );
  if (!stylesheetLoaded)
    throw new Error("browser proof did not load the compiled stylesheet");

  const proof = await page.evaluate(() => globalThis.__parakeetBrowserProof);
  if (proof.attempts !== 3 || proof.commands.length !== 3)
    throw new Error(`retry admission count drifted: ${JSON.stringify(proof)}`);
  assert.notEqual(
    proof.commands[0].requestId,
    proof.commands[1].requestId,
    "a human retry must create a fresh admission",
  );
  assert.equal(proof.commands[1].text, proof.commands[0].text);
  assert.equal(proof.commands[1].delivery, proof.commands[0].delivery);
  // A settled run's Retry control likewise creates a new admission.
  await textarea.fill("A run to retry");
  await textarea.press("Enter");
  await page
    .locator('[data-parakeet-id="browser-user-4"][data-status="confirmed"]')
    .waitFor();
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.terminateLatestRun("failed"),
  );
  await runFailure
    .getByText(
      /The run stopped\. Check the message above before trying again\./u,
    )
    .waitFor();
  await textarea.fill("A newer unsent draft");
  await runFailure.getByRole("button", { name: "Retry prompt" }).click();
  await page
    .locator('[data-parakeet-id="browser-user-5"][data-status="confirmed"]')
    .waitFor();
  const retried = await page.evaluate(() => globalThis.__parakeetBrowserProof);
  assert.equal(retried.attempts, 5);
  assert.notEqual(retried.commands[4].requestId, retried.commands[3].requestId);
  assert.equal(retried.commands[4].text, retried.commands[3].text);
  assert.equal(retried.commands[4].delivery, "followUp");
  assert.equal(await textarea.inputValue(), "A newer unsent draft");
  if (pageErrors.length > 0)
    throw new Error(`browser page errors: ${JSON.stringify(pageErrors)}`);

  await mkdir(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });

  // Live output uses the actual browser rows, CSS geometry and sticky scroller.
  await page.reload();
  await page.getByRole("combobox", { name: "Message", exact: true }).waitFor();
  const scroller = page.locator("[data-chat-scroller]");
  async function followLiveOutput() {
    // Use the reader's actual follow action: assigning scrollTop does not
    // release a pinned history window when the reset changes its geometry.
    await scroller.hover();
    await page.mouse.wheel(0, -300);
    await page.getByRole("button", { name: "Jump to bottom" }).click();
    await page.waitForFunction(() => {
      const node = globalThis.document.querySelector("[data-chat-scroller]");
      return (
        node && node.scrollHeight - node.clientHeight - node.scrollTop <= 1
      );
    });
  }
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.beginLiveOutput(),
  );
  // The reset is asynchronous. Scroll the committed new history, not the
  // previous viewport's height; the fixture already exposes this projection.
  await page
    .locator('output[aria-label="Observed tool output revision"]')
    .getByText("1", { exact: true })
    .waitFor({ state: "attached" });
  const tail = page.locator('pre[aria-label="Live tool output"]');
  await followLiveOutput();
  await tail.getByText(/^build step 1:/u).waitFor();
  const smallHeight = (await tail.boundingBox()).height;
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.updateLiveOutput(8),
  );
  await tail.getByText(/^build step 8:/u).waitFor();
  assert.equal(await tail.getByText(/^build step 1:/u).count(), 0);
  const fullHeight = (await tail.boundingBox()).height;
  assert.ok(
    fullHeight > smallHeight,
    "a short tail grows naturally until full",
  );
  const beforeLive = await scroller.evaluate((node) => ({
    height: node.scrollHeight,
    top: node.scrollTop,
  }));
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.updateLiveOutput(30, 2048),
  );
  await tail.getByText(/^build step 30:/u).waitFor();
  assert.equal(
    await tail.getByText("… 2 KiB earlier", { exact: true }).count(),
    0,
  );
  assert.equal(
    (await tail.boundingBox()).height,
    fullHeight,
    "full folded height stays fixed when bytes drop",
  );
  assert.equal(
    await scroller.evaluate((node) => node.scrollHeight),
    beforeLive.height,
  );
  const liveToggle = page
    .locator("[data-parakeet-call] button[aria-expanded]")
    .first();
  await liveToggle.click();
  await tail.getByText(/^build step 1:/u).waitFor();
  await tail.getByText("… 2 KiB earlier", { exact: true }).waitFor();
  assert.equal(
    await tail.locator("span").count(),
    31,
    "opened tail shows all lines and its marker",
  );
  await liveToggle.click();
  await tail.getByText(/^build step 25:/u).waitFor();

  // Exercise ordinary wheel intent from a fresh folded reader, independent
  // of the disclosure resizing and jump animation tested above.
  await page.reload();
  await page.getByRole("combobox", { name: "Message", exact: true }).waitFor();
  await page.evaluate(() => {
    globalThis.__parakeetBrowserProof.beginLiveOutput();
    globalThis.__parakeetBrowserProof.updateLiveOutput(30, 2048);
  });
  await page
    .locator('output[aria-label="Observed tool output revision"]')
    .getByText("2", { exact: true })
    .waitFor({ state: "attached" });
  await followLiveOutput();
  await tail.getByText(/^build step 30:/u).waitFor();
  const jump = page.getByRole("button", { name: "Jump to bottom" });
  const remaining = await scroller.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  );
  if (remaining > 1) await jump.click();
  await page.waitForFunction(() => {
    const node = globalThis.document.querySelector("[data-chat-scroller]");
    return (
      node !== null &&
      node.scrollHeight - node.clientHeight - node.scrollTop <= 1
    );
  });
  await scroller.hover();
  await jump.waitFor({ state: "hidden" });
  const wheelSettled = scroller.evaluate(
    (node) =>
      new Promise((resolve) => {
        node.addEventListener("scrollend", () => resolve(), { once: true });
      }),
  );
  await page.mouse.wheel(0, -700);
  await wheelSettled;
  await page.getByRole("button", { name: "Jump to bottom" }).waitFor();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() =>
          globalThis.requestAnimationFrame(resolve),
        ),
      ),
  );
  const viewport = () =>
    scroller.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const first = [...node.querySelectorAll("[data-parakeet-id]")].find(
        (row) => {
          const box = row.getBoundingClientRect();
          return box.bottom > bounds.top && box.top < bounds.bottom;
        },
      );
      return {
        top: node.scrollTop,
        first: first?.getAttribute("data-parakeet-id"),
        offset:
          first === undefined
            ? null
            : first.getBoundingClientRect().top - bounds.top,
      };
    });
  const away = await viewport();
  const revision = await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.updateLiveOutput(60, 4096),
  );
  // Await the public headless projection even though the away row itself is
  // deliberately unmounted by the browser virtualizer.
  await page
    .locator('output[aria-label="Observed tool output revision"]')
    .getByText(String(revision), { exact: true })
    .waitFor({ state: "attached" });
  assert.deepEqual(
    await viewport(),
    away,
    "updates leave a wheel-scrolled reader and their history anchor in place",
  );
  await jump.click();
  await page.waitForFunction(() => {
    const node = globalThis.document.querySelector("[data-chat-scroller]");
    return (
      node !== null &&
      node.scrollHeight - node.clientHeight - node.scrollTop <= 1
    );
  });
  await tail.getByText(/^build step 60:/u).waitFor();
  await jump.waitFor({ state: "hidden" });
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.finishLiveOutput(false),
  );
  await tail.waitFor({ state: "detached" });
  assert.equal(await liveToggle.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.getByText("Final build output", { exact: true }).count(),
    0,
  );
  // A fresh reader has no explicit fold choice for this fixture's reused call
  // identity, so a failed result can exercise the existing error-open default.
  await page.reload();
  await page.getByRole("combobox", { name: "Message", exact: true }).waitFor();
  const observed = page.locator(
    'output[aria-label="Observed tool output revision"]',
  );
  await observed.getByText("0", { exact: true }).waitFor({ state: "attached" });
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.beginLiveOutput(),
  );
  await observed.getByText("1", { exact: true }).waitFor({ state: "attached" });
  await followLiveOutput();
  await tail.waitFor();
  await page.evaluate(() =>
    globalThis.__parakeetBrowserProof.finishLiveOutput(true),
  );
  await observed.getByText("0", { exact: true }).waitFor({ state: "attached" });
  await tail.waitFor({ state: "detached" });
  await page
    .getByRole("alert")
    .getByText("Compiler failed", { exact: true })
    .waitFor();
  assert.equal(await liveToggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(pageErrors, []);

  process.stdout.write(
    `${JSON.stringify({ proof: "parakeet-browser", attempts: retried.attempts, screenshot, stylesheet: "compiled", verdict: "pass" })}\n`,
  );
} catch (cause) {
  if (page !== undefined) {
    await page.screenshot({ path: screenshot.replace(".png", "-failure.png") });
    await writeFile(
      screenshot.replace(".png", "-failure.html"),
      await page.content(),
    );
    process.stderr.write(`${await page.locator("body").innerText()}\n`);
  }
  throw cause;
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
