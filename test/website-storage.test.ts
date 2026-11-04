import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { afterEach, expect, it, vi } from "vitest";
import { embedStorage } from "../src/website-storage.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a blocked visitor iframe's storage failure distinct from absence", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("private visitor token");
    },
    setItem: () => {
      throw new Error("private visitor token");
    },
    removeItem: () => {
      throw new Error("private visitor token");
    },
  });
  expect(Result.isFailure(embedStorage.read("visitor"))).toBe(true);
  expect(Result.isFailure(embedStorage.write("visitor", "secret"))).toBe(true);
  expect(Result.isFailure(embedStorage.remove("visitor"))).toBe(true);
  expect(warn).toHaveBeenCalledTimes(3);
  const decodeLog = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Json),
  );
  const records = warn.mock.calls.map(([message]) =>
    decodeLog(String(message)),
  );
  for (const [index, stage] of ["read", "write", "remove"].entries())
    expect(records[index]).toMatchObject({
      event: "browser_storage_unavailable",
      level: "warn",
      code: "local",
      stage,
    });
  expect(warn.mock.calls.join(" ")).not.toContain("private visitor token");
});
