import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt";

describe("access tokens", () => {
  it("round-trips a signed token", async () => {
    const token = await signAccessToken(
      { id: "user-1", email: "a@example.com", role: "customer", isAdmin: false },
      "test-secret"
    );
    const payload = await verifyAccessToken(token, "test-secret");
    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("a@example.com");
    expect(payload.role).toBe("customer");
    expect(payload.isAdmin).toBe(false);
  });

  it("carries isAdmin through for a driver account that also has admin rights", async () => {
    // The owner-operator shape: role stays "driver" so every existing
    // driver-only check keeps working unmodified; isAdmin is what separately
    // unlocks the admin panel on top of that.
    const token = await signAccessToken(
      { id: "user-2", email: "owner@example.com", role: "driver", isAdmin: true },
      "test-secret"
    );
    const payload = await verifyAccessToken(token, "test-secret");
    expect(payload.role).toBe("driver");
    expect(payload.isAdmin).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken(
      { id: "user-1", email: "a@example.com", role: "customer", isAdmin: false },
      "test-secret"
    );
    await expect(verifyAccessToken(token, "wrong-secret")).rejects.toThrow();
  });
});
