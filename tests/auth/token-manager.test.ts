import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config";
import {
  clearTokenValidationCache,
  refreshAccessTokenIfExpiringSoon,
  validateAccessToken,
} from "../../src/auth/token-manager";

function createConfig(): Config {
  const config = {
    twitchAccessToken: "old-access",
    twitchRefreshToken: "old-refresh",
    twitchClientId: "client-id",
    twitchSecretToken: "client-secret",
    setActiveAuthScopes: vi.fn(),
    hasScopeEchoed: vi.fn(() => false),
    markScopeEchoed: vi.fn(),
    updateAccessToken: vi.fn((accessToken: string, refreshToken: string) => {
      config.twitchAccessToken = accessToken;
      config.twitchRefreshToken = refreshToken;
    }),
  };

  return config as unknown as Config;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("token-manager", () => {
  beforeEach(() => {
    clearTokenValidationCache();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTokenValidationCache();
  });

  it("refreshes the access token before a short validated token expires", async () => {
    const config = createConfig();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          login: "rukalun",
          scopes: ["chat:read", "chat:edit"],
          expires_in: 120,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "new-access",
          refresh_token: "new-refresh",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          login: "rukalun",
          scopes: ["chat:read", "chat:edit"],
          expires_in: 3600,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(validateAccessToken(config)).resolves.toBe("old-access");
    await expect(refreshAccessTokenIfExpiringSoon(config, 300)).resolves.toBe(
      "new-access"
    );

    expect(config.updateAccessToken).toHaveBeenCalledWith(
      "new-access",
      "new-refresh"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not refresh while the validated token has enough lifetime", async () => {
    const config = createConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        login: "rukalun",
        scopes: ["chat:read", "chat:edit"],
        expires_in: 3600,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshAccessTokenIfExpiringSoon(config, 300)).resolves.toBe(
      "old-access"
    );

    expect(config.updateAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
