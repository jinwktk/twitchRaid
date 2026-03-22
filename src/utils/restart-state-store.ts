import fs from "fs";

/**
 * 最後の再起動時刻を読み込む
 */
export function loadLastRestart(filePath: string): number | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8").trim();
    const value = parseFloat(content);
    return isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

/**
 * 最後の再起動時刻を保存する
 */
export function saveLastRestart(filePath: string, timestamp: number): void {
  fs.writeFileSync(filePath, String(timestamp), "utf-8");
}

/**
 * 再起動が必要かどうかを判定する
 * @returns [shouldRestart, nextTimestamp]
 */
export function evaluateRestart(
  now: number,
  last: number | null,
  interval: number
): [boolean, number] {
  if (last === null) {
    return [false, now];
  }
  if (now - last >= interval) {
    return [true, now];
  }
  return [false, last];
}
