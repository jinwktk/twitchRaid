import logger from "../utils/logger";

/**
 * DLsiteランキングHTMLからマンガタイトルを抽出する
 */
export function extractMangaTitles(rankingHtml: string): string[] {
  // <a>タグの中身を抽出
  const anchorRegex = /<a[^>]*>([^<]+)<\/a>/g;
  const titles: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(rankingHtml)) !== null) {
    const title = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .trim();
    if (title && !titles.includes(title)) {
      titles.push(title);
    }
  }

  return titles.sort();
}

/**
 * タイトルリストからランダムに1つ選択する
 */
export function selectMangaTitle(titles: string[]): string | null {
  if (titles.length === 0) return null;
  const idx = Math.floor(Math.random() * titles.length);
  return titles[idx];
}

/**
 * DLsiteからランダムなマンガタイトルを取得する
 */
export async function fetchRandomMangaTitle(): Promise<string | null> {
  try {
    const response = await fetch(
      "https://www.dlsite.com/maniax/ranking/day/=/date/30d/category/comic",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const titles = extractMangaTitles(html);
    return selectMangaTitle(titles);
  } catch (e) {
    logger.error(`❌ mangaランキング取得失敗: ${e}`);
    throw e;
  }
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
