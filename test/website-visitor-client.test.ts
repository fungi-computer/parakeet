import { afterEach, expect, it, vi } from "vitest";
import { createVisitorClient } from "../src/website-visitor-client.js";

const siteKey = "site_pk_123456789012345678901";
const credentials = {
  visitorId: "visitor",
  accessToken: `vt_${"A".repeat(43)}`,
  accessExpiresAt: Date.now() + 3_600_000,
  refreshSecret: `vr_${"B".repeat(43)}`,
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function recordedFetch() {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const sent = await new Response(init.body).text();
      bodies.push(`${url.split("/").pop() ?? ""} ${sent}`);
      return url.endsWith("/visitors")
        ? Response.json(credentials, { status: 201 })
        : Response.json({ error: "stop" }, { status: 500 });
    }),
  );
  return bodies;
}

it("sends a site's Turnstile token with the mint and nowhere else", async () => {
  const bodies = recordedFetch();
  const session = createVisitorClient(siteKey, {
    challenge: () => Promise.resolve("passed-token"),
  });
  await expect(session.read()).rejects.toThrow();
  expect(bodies[0]).toBe('visitors {"turnstileToken":"passed-token"}');
  expect(bodies[1]).toBe("session {}");
});

it("mints without a token for a site that does not ask for one", async () => {
  const bodies = recordedFetch();
  await expect(createVisitorClient(siteKey).read()).rejects.toThrow();
  expect(bodies[0]).toBe("visitors {}");
});

it("does not mint when the check cannot be completed", async () => {
  const bodies = recordedFetch();
  const session = createVisitorClient(siteKey, {
    challenge: () => Promise.reject(new Error("turnstile_failed")),
  });
  await expect(session.read()).rejects.toThrow("turnstile_failed");
  expect(bodies).toEqual([]);
});
