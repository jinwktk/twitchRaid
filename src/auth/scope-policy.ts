/**
 * OAuth スコープポリシー
 */

/**
 * 付与済みスコープから不足しているスコープ値を返す
 */
export function missingScopeValues(
  grantedScopes: string[],
  requiredScopes: string[]
): string[] {
  const grantedSet = new Set(grantedScopes);
  return requiredScopes.filter((scope) => !grantedSet.has(scope));
}

/**
 * 付与済みスコープから有効なスコープリストを返す
 * 空の場合はデフォルトを返す
 */
export function activeAuthScopesFromGranted(
  grantedScopes: string[],
  defaultScopes: string[]
): string[] {
  if (grantedScopes.length === 0) {
    return [...defaultScopes];
  }
  return [...new Set(grantedScopes)];
}

/**
 * スコープ値をソートして正規化する
 */
export function normalizeScopeValues(scopes: string[]): string[] {
  return [...new Set(scopes)].sort();
}
