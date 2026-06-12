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
  gameId: string | null;
  gameName: string | null;
  thumbnailUrl: string | null;
  createdAt: string | null;
  views: number | null;
}

export interface StreamSummaryClip {
  id: string;
  url: string;
  title: string;
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
  game_id: string | null;
  game_name: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
  views: number | null;
  unavailable_at: string | null;
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

interface ExistingClipAvailabilityRow {
  unavailable_at: string | null;
}

export interface SelectCachedClipParams {
  historyKey: string;
  creatorId?: string;
  creatorName?: string;
  random?: () => number;
}

export interface SearchCachedClipParams {
  historyKey: string;
  query: string;
  random?: () => number;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
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

    const findExisting = this.db.prepare(
      "SELECT unavailable_at FROM clip_cache WHERE id = ?"
    );
    const insert = this.db.prepare(`
      INSERT INTO clip_cache (
        id,
        url,
        title,
        creator_id,
        creator_display_name,
        creator_name_lower,
        game_id,
        game_name,
        thumbnail_url,
        created_at,
        views,
        last_seen_at,
        unavailable_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        title = excluded.title,
        creator_id = excluded.creator_id,
        creator_display_name = excluded.creator_display_name,
        creator_name_lower = excluded.creator_name_lower,
        game_id = excluded.game_id,
        game_name = excluded.game_name,
        thumbnail_url = excluded.thumbnail_url,
        created_at = excluded.created_at,
        views = excluded.views,
        last_seen_at = excluded.last_seen_at,
        unavailable_at = NULL,
        updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    let saved = 0;

    this.db.exec("BEGIN");
    try {
      for (const clip of clips) {
        const existing = findExisting.get(
          clip.id
        ) as ExistingClipAvailabilityRow | undefined;
        const newlyAvailable = !existing || existing.unavailable_at !== null;
        insert.run(
          clip.id,
          clip.url,
          clip.title,
          clip.creatorId,
          clip.creatorDisplayName,
          clip.creatorDisplayName.toLowerCase(),
          clip.gameId ?? null,
          clip.gameName ?? null,
          clip.thumbnailUrl ?? null,
          clip.createdAt,
          clip.views,
          now,
          now
        );
        if (newlyAvailable) saved++;
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }

    return saved;
  }

  markMissingClipsUnavailable(
    startAt: string,
    endAt: string,
    availableClipIds: string[],
    markedAt = new Date().toISOString()
  ): number {
    const filters = [
      "created_at IS NOT NULL",
      "created_at >= ?",
      "created_at < ?",
      "unavailable_at IS NULL",
    ];
    const params: (string | number)[] = [startAt, endAt];

    if (availableClipIds.length > 0) {
      filters.push(
        `id NOT IN (${availableClipIds.map(() => "?").join(", ")})`
      );
      params.push(...availableClipIds);
    }

    const result = this.db
      .prepare(
        `
        UPDATE clip_cache
        SET unavailable_at = ?, updated_at = ?
        WHERE ${filters.join(" AND ")}
      `
      )
      .run(markedAt, markedAt, ...params);

    return Number(result.changes);
  }

  listAvailableClipIdsCreatedBetween(startAt: string, endAt: string): string[] {
    return this.db
      .prepare(
        `
        SELECT id
        FROM clip_cache
        WHERE created_at IS NOT NULL
          AND created_at >= ?
          AND created_at < ?
          AND unavailable_at IS NULL
        ORDER BY created_at ASC, id ASC
      `
      )
      .all(startAt, endAt)
      .map((row) => (row as { id: string }).id);
  }

  markClipsUnavailableByIds(
    clipIds: string[],
    markedAt = new Date().toISOString()
  ): number {
    if (clipIds.length === 0) return 0;

    const result = this.db
      .prepare(
        `
        UPDATE clip_cache
        SET unavailable_at = ?, updated_at = ?
        WHERE unavailable_at IS NULL
          AND id IN (${clipIds.map(() => "?").join(", ")})
      `
      )
      .run(markedAt, markedAt, ...clipIds);

    return Number(result.changes);
  }

  restoreUnavailableClipsCreatedAfter(
    cutoffCreatedAt: string,
    restoredAt = new Date().toISOString()
  ): number {
    const result = this.db
      .prepare(
        `
        UPDATE clip_cache
        SET unavailable_at = NULL,
            updated_at = ?
        WHERE unavailable_at IS NOT NULL
          AND created_at IS NOT NULL
          AND created_at >= ?
      `
      )
      .run(restoredAt, cutoffCreatedAt);

    return Number(result.changes);
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

  searchRandomClip({
    historyKey,
    query,
    random = Math.random,
  }: SearchCachedClipParams): ClipInfo | null {
    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return null;

    const recentIds = new Set(this.getRecentIds(historyKey));
    const freshClip = this.findRandomSearchCandidateRow(
      normalizedQuery,
      [...recentIds],
      random
    );
    const clip =
      freshClip ?? this.findRandomSearchCandidateRow(normalizedQuery, [], random);

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

  listClipsCreatedBetween(
    startAt: string,
    endAt: string,
    limit = 10
  ): StreamSummaryClip[] {
    return this.db
      .prepare(
        `
        SELECT id, url, title, creator_display_name, created_at, views
        FROM clip_cache
        WHERE created_at IS NOT NULL
          AND created_at >= ?
          AND created_at <= ?
          AND unavailable_at IS NULL
        ORDER BY COALESCE(views, 0) DESC, created_at ASC, id ASC
        LIMIT ?
      `
      )
      .all(startAt, endAt, limit)
      .map((row) => {
        const clip = row as {
          id: string;
          url: string;
          title: string;
          creator_display_name: string;
          created_at: string | null;
          views: number | null;
        };
        return {
          id: clip.id,
          url: clip.url,
          title: clip.title,
          creatorDisplayName: clip.creator_display_name,
          createdAt: clip.created_at,
          views: clip.views,
        };
      });
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

    filters.push("unavailable_at IS NULL");

    const where = `WHERE ${filters.join(" AND ")}`;
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

  private findRandomSearchCandidateRow(
    query: string,
    excludeIds: string[] = [],
    random: () => number = Math.random
  ): ClipRow | null {
    const escapedQuery = escapeSqlLike(query);
    const escapedLowerQuery = escapeSqlLike(query.toLowerCase());
    const pattern = `%${escapedQuery}%`;
    const lowerPattern = `%${escapedLowerQuery}%`;
    const filters = [
      "(title LIKE ? ESCAPE '\\' OR creator_name_lower LIKE ? ESCAPE '\\' OR game_name LIKE ? ESCAPE '\\')",
      "unavailable_at IS NULL",
    ];
    const params: (string | number)[] = [pattern, lowerPattern, pattern];

    if (excludeIds.length > 0) {
      filters.push(`id NOT IN (${excludeIds.map(() => "?").join(", ")})`);
      params.push(...excludeIds);
    }

    const where = `WHERE ${filters.join(" AND ")}`;
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
        game_id TEXT,
        game_name TEXT,
        thumbnail_url TEXT,
        created_at TEXT,
        views INTEGER,
        last_seen_at TEXT,
        unavailable_at TEXT,
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
    this.addColumnIfMissing("clip_cache", "last_seen_at", "TEXT");
    this.addColumnIfMissing("clip_cache", "unavailable_at", "TEXT");
    this.addColumnIfMissing("clip_cache", "game_id", "TEXT");
    this.addColumnIfMissing("clip_cache", "game_name", "TEXT");
    this.addColumnIfMissing("clip_cache", "thumbnail_url", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_clip_cache_available_created_at
        ON clip_cache (unavailable_at, created_at);
    `);
  }

  private addColumnIfMissing(
    tableName: string,
    columnName: string,
    definition: string
  ): void {
    const columns = this.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) return;

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
