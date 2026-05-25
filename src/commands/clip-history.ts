import fs from "fs";
import path from "path";
import logger from "../utils/logger";

interface ClipHistoryData {
  version: 1;
  histories: Record<string, string[]>;
}

function emptyData(): ClipHistoryData {
  return {
    version: 1,
    histories: {},
  };
}

export class ClipHistoryStore {
  constructor(
    private readonly filePath: string,
    private readonly maxEntriesPerKey = 200
  ) {}

  getRecentIds(key: string): string[] {
    const data = this.read();
    return [...(data.histories[key] ?? [])];
  }

  record(key: string, clipId: string): void {
    const data = this.read();
    const current = data.histories[key] ?? [];
    data.histories[key] = [
      clipId,
      ...current.filter((existingId) => existingId !== clipId),
    ].slice(0, this.maxEntriesPerKey);
    this.write(data);
  }

  private read(): ClipHistoryData {
    if (!fs.existsSync(this.filePath)) {
      return emptyData();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as {
        version?: number;
        histories?: Record<string, string[]>;
      };
      if (parsed.version !== 1 || typeof parsed.histories !== "object") {
        return emptyData();
      }

      return {
        version: 1,
        histories: sanitizeHistories(parsed.histories ?? {}),
      };
    } catch (e) {
      logger.warn(`⚠️ clip履歴ファイルの読み込みに失敗しました: ${e}`);
      return emptyData();
    }
  }

  private write(data: ClipHistoryData): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        `${JSON.stringify(data, null, 2)}\n`,
        "utf-8"
      );
    } catch (e) {
      logger.warn(`⚠️ clip履歴ファイルの保存に失敗しました: ${e}`);
    }
  }
}

function sanitizeHistories(
  rawHistories: Record<string, unknown>
): Record<string, string[]> {
  const histories: Record<string, string[]> = {};

  for (const [key, values] of Object.entries(rawHistories)) {
    if (Array.isArray(values)) {
      histories[key] = values.filter(
        (value): value is string => typeof value === "string"
      );
    }
  }

  return histories;
}
