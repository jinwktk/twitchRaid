import type { AuthProvider } from "@twurple/auth";

export function createEventSubAuthProvider(
  source: AuthProvider,
  tokenUserId: string
): AuthProvider {
  const refreshAccessTokenForUser = source.refreshAccessTokenForUser
    ? async () => source.refreshAccessTokenForUser!(tokenUserId)
    : undefined;

  return {
    clientId: source.clientId,
    authorizationType: source.authorizationType,
    getCurrentScopesForUser: () =>
      source.getCurrentScopesForUser(tokenUserId),
    getAccessTokenForUser: (_requestedUser, ...scopeSets) =>
      source.getAccessTokenForUser(tokenUserId, ...scopeSets),
    getAnyAccessToken: () => source.getAnyAccessToken(tokenUserId),
    refreshAccessTokenForUser,
  };
}
