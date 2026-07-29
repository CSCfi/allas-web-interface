import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { awsListBuckets, setProjectSuspendedHandler } from "@/common/api";

// Mock fetch per-URL: the bucket listing returns `bucketStatus`, while the
// session probe (/api/username) returns `sessionOk`.
function mockFetch({ bucketStatus, sessionOk }) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url) => {
      if (String(url).includes("/api/username")) {
        return Promise.resolve({ ok: sessionOk, status: sessionOk ? 200 : 401 });
      }
      return Promise.resolve({
        status: bucketStatus,
        json: async () => ({}),
      });
    }),
  );
}

describe("awsListBuckets 401 handling", () => {
  const originalLocation = window.location;
  let suspendedCalls;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/browse" },
    });
    suspendedCalls = [];
    setProjectSuspendedHandler((suspended) => suspendedCalls.push(suspended));
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    setProjectSuspendedHandler(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("flags the project as suspended instead of redirecting when the session is still valid", async () => {
    mockFetch({ bucketStatus: 401, sessionOk: true });

    const result = await awsListBuckets("test-project");

    expect(window.location.pathname).toBe("/browse");
    expect(suspendedCalls).toContain(true);
    expect(result).toEqual({ Buckets: [] });
  });

  it("still redirects to /unauth when the session itself is dead", async () => {
    mockFetch({ bucketStatus: 401, sessionOk: false });

    await awsListBuckets("test-project");

    expect(window.location.pathname).toBe("/unauth");
    expect(suspendedCalls).not.toContain(true);
  });

  it("clears the suspended flag on a successful listing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          status: 200,
          json: async () => ({ Buckets: [] }),
        }),
      ),
    );

    await awsListBuckets("test-project");

    expect(suspendedCalls).toContain(false);
  });

  it("still throws for other non-200 statuses", async () => {
    mockFetch({ bucketStatus: 500, sessionOk: true });

    await expect(awsListBuckets("test-project")).rejects.toThrow();
  });
});
