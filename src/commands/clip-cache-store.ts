import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type { ClipInfo } from "./clip";

export interface CachedClip {
  id: string;
  url: string;
  title: string;
  creatorId: string;
  creatorDisplayName: string;
  createdAt: string | null;
  views: number | null;
}

interface ClipRow {
  id: string;
  url: string;
  title: string;
  creator_id: string;
  creator_display_name: string;
  creator_name_lower: string;
  created_at: string | null;
  views: number | null;
}

interface ScanWindowRow {
  status: string;
}

interface SyncStateRow {
  value: string;
}

interface CountRow {
  count: number;
}

export interface SelectCachedClipParams {
  historyKey: string;
  creatorId?: string;
  creatorName?: string;
  random?: () => number;
}

export class ClipCacheStore {
  private readonly db: DatabaseSync;

  constructor(
    dbPath: string,
    private readonly maxHistoryPerKey = 200
  ) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  saveClips(clips: CachedClip[]): number {
    if (clips.length === 0) return 0;

    const insert = this.db.prepare(`
      INSERT INTO clip_cache (
        id,
        url,
        title,
        creator_id,
        creator_display_name,
        creator_name_lower,
        created_at,
        views,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        title = excluded.title,
        creator_id = excluded.creator_id,
        creator_display_name = excluded.creator_display_name,
        creator_name_lower = excluded.creator_name_lower,
        created_at = excluded.created_at,
        views = excluded.views,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    let saved = 0;

    this.db.exec("BEGIN");
    try {
      for (const clip of clips) {
        insert.run(
          clip.id,
          clip.url,
          clip.title,
          clip.creatorId,
          clip.creatorDisplayName,
          clip.creatorDisplayName.toLowerCase(),
          clip.createdAt,
          clip.views,
          now
        );
        saved++;
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return saved;
  }

  selectRandomClip({
    historyKey,
    creatorId,
    creatorName,
    random = Math.random,
  }: SelectCachedClipParams): ClipInfo | null {
    const recentIds = new Set(this.getRecentIds(historyKey));
    const freshClip = this.findRandomCandidateRow(
      creatorId,
      creatorName,
      [...recentIds],
      random
    );
    const clip =
      freshClip ??
      this.findRandomCandidateRow(creatorId, creatorName, [], random);

    if (!clip) return null;

    return {
      id: clip.id,
      url: clip.url,
      title: clip.title,
    };
  }

  recordHistory(
    historyKey: string,
    clipId: string,
    shownAt = Date.now()
  ): void {
    this.db
      .prepare(
        `
        INSERT INTO clip_history (history_key, clip_id, shown_at)
        VALUES (?, ?, ?)
        ON CONFLICT(history_key, clip_id) DO UPDATE SET
          shown_at = excluded.shown_at
      `
      )
      .run(historyKey, clipId, shownAt);

    this.db
      .prepare(
        `
        DELETE FROM clip_history
        WHERE history_key = ?
          AND clip_id NOT IN (
            SELECT clip_id
            FROM clip_history
            WHERE history_key = ?
            ORDER BY shown_at DESC
            LIMIT ?
          )
      `
      )
      .run(historyKey, historyKey, this.maxHistoryPerKey);
  }

  getRecentIds(historyKey: string): string[] {
    return this.db
      .prepare(
        `
        SELECT clip_id
        FROM clip_history
        WHERE history_key = ?
        ORDER BY shown_at DESC
      `
      )
      .all(historyKey)
      .map((row) => (row as { clip_id: string }).clip_id);
  }

  clipCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM clip_cache")
      .get() as { count: number };
    return row.count;
  }

  markWindowCompleted(startAt: string, endAt: string, clipCount: number): void {
    this.db
      .prepare(
        `
        INSERT INTO clip_scan_windows (
          start_at,
          end_at,
          status,
          clip_count,
          scanned_at
        )
        VALUES (?, ?, 'completed', ?, ?)
        ON CONFLICT(start_at, end_at) DO UPDATE SET
          status = 'completed',
          clip_count = excluded.clip_count,
          scanned_at = excluded.scanned_at
      `
      )
      .run(startAt, endAt, clipCount, new Date().toISOString());
  }

  isWindowCompleted(startAt: string, endAt: string): boolean {
    const row = this.db
      .prepare(
        `
        SELECT status
        FROM clip_scan_windows
        WHERE start_at = ? AND end_at = ?
      `
      )
      .get(startAt, endAt) as ScanWindowRow | undefined;
    return row?.status === "completed";
  }

  setSyncState(key: string, value: string): void {
    this.db
      .prepare(
        `
        INSERT INTO clip_sync_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
      )
      .run(key, value, new Date().toISOString());
  }

  getSyncState(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM clip_sync_state WHERE key = ?")
      .get(key) as SyncStateRow | undefined;
    return row?.value ?? null;
  }

  private findRandomCandidateRow(
    creatorId?: string,
    creatorName?: string,
    excludeIds: string[] = [],
    random: () => number = Math.random
  ): ClipRow | null {
    const normalizedCreatorName = creatorName?.trim().toLowerCase();
    const filters: string[] = [];
    const params: (string | number)[] = [];

    if (creatorId) {
      filters.push("creator_id = ?");
      params.push(creatorId);
    }

    if (normalizedCreatorName) {
      filters.push("creator_name_lower = ?");
      params.push(normalizedCreatorName);
    }

    if (excludeIds.length > 0) {
      filters.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`);
      params.push(...excludeIds);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS count FROM clip_cache ${where}`)
      .get(...params) as unknown as CountRow;

    if (countRow.count === 0) return null;

    const offset = Math.min(
      Math.floor(random() * countRow.count),
      countRow.count - 1
    );

    return this.db
      .prepare(
        `
        SELECT *
        FROM clip_cache
        ${where}
        ORDER BY created_at DESC, id ASC
        LIMIT 1 OFFSET ?
      `
      )
      .get(...params, offset) as unknown as ClipRow;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clip_cache (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        creator_id TEXT NOT NULL,
        creator_display_name TEXT NOT NULL,
        creator_name_lower TEXT NOT NULL,
        created_at TEXT,
        views INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_clip_cache_creator_id
        ON clip_cache (creator_id);
      CREATE INDEX IF NOT EXISTS idx_clip_cache_creator_name
        ON clip_cache (creator_name_lower);
      CREATE INDEX IF NOT EXISTS idx_clip_cache_created_at
        ON clip_cache (created_at);

      CREATE TABLE IF NOT EXISTS clip_history (
        history_key TEXT NOT NULL,
        clip_id TEXT NOT NULL,
        shown_at INTEGER NOT NULL,
        PRIMARY KEY (history_key, clip_id)
      );

      CREATE INDEX IF NOT EXISTS idx_clip_history_key_shown
        ON clip_history (history_key, shown_at DESC);

      CREATE TABLE IF NOT EXISTS clip_scan_windows (
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        status TEXT NOT NULL,
        clip_count INTEGER NOT NULL,
        scanned_at TEXT NOT NULL,
        PRIMARY KEY (start_at, end_at)
      );

      CREATE TABLE IF NOT EXISTS clip_sync_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }
}
