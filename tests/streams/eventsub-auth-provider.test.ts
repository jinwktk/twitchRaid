import { describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "@twurple/auth";
import { createEventSubAuthProvider } from "../../src/streams/eventsub-auth-provider";

describe("createEventSubAuthProvider", () => {
  it("uses the Bot user token for broadcaster-scoped EventSub requests and refreshes", async () => {
    const token = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      obtainmentTimestamp: Date.now(),
      scope: [],
      userId: "bot-user-id",
    };
    const source = {
      clientId: "client-id",
      getCurrentScopesForUser: vi.fn(() => []),
      getAccessTokenForUser: vi.fn().mockResolvedValue(token),
      getAnyAccessToken: vi.fn().mockResolvedValue(token),
      refreshAccessTokenForUser: vi.fn().mockResolvedValue(token),
    } satisfies AuthProvider;

    const provider = createEventSubAuthProvider(source, "bot-user-id");

    await expect(
      provider.getAccessTokenForUser("broadcaster-id", ["channel:read:subscriptions"])
    ).resolves.toBe(token);
    await expect(provider.getAnyAccessToken("broadcaster-id")).resolves.toBe(token);
    await expect(
      provider.refreshAccessTokenForUser?.("broadcaster-id")
    ).resolves.toBe(token);
    expect(provider.getCurrentScopesForUser("broadcaster-id")).toEqual([]);

    expect(source.getAccessTokenForUser).toHaveBeenCalledWith(
      "bot-user-id",
      ["channel:read:subscriptions"]
    );
    expect(source.getAnyAccessToken).toHaveBeenCalledWith("bot-user-id");
    expect(source.refreshAccessTokenForUser).toHaveBeenCalledWith("bot-user-id");
    expect(source.getCurrentScopesForUser).toHaveBeenCalledWith("bot-user-id");
  });
});
