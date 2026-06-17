import { describe, expect, it } from "vitest";
import {
  EMOTE_READ_REAUTH_SCOPES,
  REAUTH_AUTH_SCOPES,
  REQUIRED_AUTH_SCOPES,
} from "../../src/auth/auth-scope-sets";

describe("Twitch auth scope sets", () => {
  it("keeps emote reading out of the minimum startup scopes", () => {
    expect(REQUIRED_AUTH_SCOPES).not.toContain("user:read:emotes");
  });

  it("requests user emote read access during reauthorization", () => {
    expect(EMOTE_READ_REAUTH_SCOPES).toEqual(["user:read:emotes"]);
    expect(REAUTH_AUTH_SCOPES).toContain("user:read:emotes");
  });

  it("keeps reauthorization scopes unique while preserving required scopes", () => {
    for (const scope of REQUIRED_AUTH_SCOPES) {
      expect(REAUTH_AUTH_SCOPES).toContain(scope);
    }
    expect(new Set(REAUTH_AUTH_SCOPES).size).toBe(REAUTH_AUTH_SCOPES.length);
  });
});
