import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt";

describe("access tokens", () => {
  it("round-trips a signed token", async () => {
    const token = await signAccessToken({ id: "user-1", email: "a@example.com", role: "customer" }, "test-secret");
    const payload = await verifyAccessToken(token, "test-secret");
    expect(payload.sub).toBe("user-1");
    expect(payload.email).toBe("a@example.com");
    expect(payload.role).toBe("customer");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken({ id: "user-1", email: "a@example.com", role: "customer" }, "test-secret");
    await expect(verifyAccessToken(token, "wrong-secret")).rejects.toThrow();
  });
});
