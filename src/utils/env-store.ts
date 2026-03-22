import fs from "fs";
import path from "path";

const BACKUP_SUFFIX = ".backup";
const TEMP_SUFFIX = ".tmp";

/**
 * .envファイルを安全に更新する（コメントと空行を保持）
 */
export function updateEnvFile(
  envFile: string,
  updates: Record<string, string>
): void {
  const absPath = path.resolve(envFile);
  const backupPath = absPath + BACKUP_SUFFIX;
  const tempPath = absPath + TEMP_SUFFIX;

  let lines: string[] = [];
  if (fs.existsSync(absPath)) {
    lines = fs.readFileSync(absPath, "utf-8").split("\n");
  }

  const remaining = new Set(Object.keys(updates));
  const newLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      newLines.push(line);
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      newLines.push(line);
      continue;
    }

    const key = trimmed.substring(0, eqIdx).trim();
    if (key in updates) {
      newLines.push(`${key}=${updates[key]}`);
      remaining.delete(key);
    } else {
      newLines.push(line);
    }
  }

  // 新しいキーを追加
  for (const key of remaining) {
    newLines.push(`${key}=${updates[key]}`);
  }

  // バックアップ作成
  if (fs.existsSync(absPath)) {
    fs.copyFileSync(absPath, backupPath);
  }

  // 一時ファイル経由でアトミック書き込み
  fs.writeFileSync(tempPath, newLines.join("\n"), "utf-8");
  fs.renameSync(tempPath, absPath);
}
