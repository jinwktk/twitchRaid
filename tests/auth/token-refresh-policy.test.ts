import { describe, it, expect } from "vitest";
import { shouldTryFallback } from "../../src/auth/token-refresh-policy";

describe("shouldTryFallback", () => {
  it("returns true for 400 Bad Request", () => {
    expect(shouldTryFallback(400)).toBe(true);
  });

  it("returns true for 401 Unauthorized", () => {
    expect(shouldTryFallback(401)).toBe(true);
  });

  it("returns true for 499 (upper boundary of 4xx)", () => {
    expect(shouldTryFallback(499)).toBe(true);
  });

  it("returns false for 500 Internal Server Error", () => {
    expect(shouldTryFallback(500)).toBe(false);
  });

  it("returns false for 503 Service Unavailable", () => {
    expect(shouldTryFallback(503)).toBe(false);
  });

  it("returns false for 399 (below 4xx range)", () => {
    expect(shouldTryFallback(399)).toBe(false);
  });

  it("returns false for 200 OK", () => {
    expect(shouldTryFallback(200)).toBe(false);
  });
});
