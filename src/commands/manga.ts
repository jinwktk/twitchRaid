import logger from "../utils/logger";

const MANGA_RANKING_URLS = [
  "https://www.dlsite.com/maniax/ranking/day/=/date/30d/category/comic",
  "https://www.dlsite.com/girls/ranking/day",
] as const;

export interface MangaRecommendation {
  title: string;
  url: string;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function selectRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

/**
 * DLsiteランキングHTMLからマンガタイトルと作品URLを抽出する
 * product_idを含む作品リンクのみを対象にする
 */
export function extractMangaRecommendations(
  rankingHtml: string,
  rankingUrl: string = MANGA_RANKING_URLS[0]
): MangaRecommendation[] {
  // product_idを含む作品リンクのみ抽出（ナビ・ジャンル等を除外）
  const anchorRegex =
    /<a\s+href="([^"]*\/product_id\/[^"]*)"[^>]*>([^<]+)<\/a>/g;
  const recommendations: MangaRecommendation[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(rankingHtml)) !== null) {
    const url = new URL(
      decodeHtmlEntities(match[1]),
      rankingUrl
    ).toString();
    const title = decodeHtmlEntities(match[2]).trim();
    // ボタン・レビュー件数等を除外（作品タイトルのみ）
    if (
      title &&
      !recommendations.some(
        (recommendation) => recommendation.title === title
      ) &&
      !title.match(/^[\d()（）]+$/) &&
      !["カートに追加", "お気に入りに追加", "無料サンプル"].includes(title)
    ) {
      recommendations.push({ title, url });
    }
  }

  return recommendations;
}

/**
 * DLsiteランキングHTMLからマンガタイトルを抽出する
 */
export function extractMangaTitles(rankingHtml: string): string[] {
  return extractMangaRecommendations(rankingHtml).map(({ title }) => title);
}

/**
 * タイトルリストからランダムに1つ選択する
 */
export function selectMangaTitle(titles: string[]): string | null {
  return selectRandom(titles);
}

/**
 * マンガ候補からランダムに1作品を選択する
 */
export function selectMangaRecommendation(
  recommendations: MangaRecommendation[]
): MangaRecommendation | null {
  return selectRandom(recommendations);
}

/**
 * DLsiteからランダムなマンガタイトルと作品URLを取得する
 */
export async function fetchRandomMangaRecommendation(): Promise<
  MangaRecommendation | null
> {
  try {
    const rankingResults = await Promise.allSettled(
      MANGA_RANKING_URLS.map(async (rankingUrl) => {
        const response = await fetch(rankingUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        return extractMangaRecommendations(html, rankingUrl);
      })
    );
    const failedResults = rankingResults.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failedResults.length === rankingResults.length) {
      throw failedResults[0].reason;
    }
    for (const failure of failedResults) {
      logger.warn(`⚠️ mangaランキングの一部取得失敗: ${failure.reason}`);
    }
    const recommendations = rankingResults.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
    return selectMangaRecommendation(recommendations);
  } catch (e) {
    logger.error(`❌ mangaランキング取得失敗: ${e}`);
    throw e;
  }
}

/**
 * DLsiteからランダムなマンガタイトルを取得する
 */
export async function fetchRandomMangaTitle(): Promise<string | null> {
  const recommendation = await fetchRandomMangaRecommendation();
  return recommendation?.title ?? null;
}

/**
 * mangaコマンドの管理者判定
 */
export function isMangaAdmin(
  userName: string | undefined,
  adminUsers: string[],
  isMod: boolean,
  isBroadcaster: boolean
): boolean {
  if (isBroadcaster) return true;
  if (isMod) return true;
  if (userName && adminUsers.includes(userName.toLowerCase())) return true;
  return false;
}
