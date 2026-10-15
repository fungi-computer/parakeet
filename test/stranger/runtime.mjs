import { URL } from "node:url";
import assert from "node:assert/strict";
import { formatModelIdentity } from "@fungi.computer/parakeet/headless";
import { readFile } from "node:fs/promises";
assert.equal(
  formatModelIdentity({ provider: "openai", model: "gpt-6-luna" }),
  "openai/gpt-6-luna",
);
const css = await readFile(
  new URL(import.meta.resolve("@fungi.computer/parakeet/styles.css")),
  "utf8",
);
assert.ok(css.length > 0);
