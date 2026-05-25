import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export type FirstCommentSource = "archive" | "live";
export type ArchiveBackfillStatus = "completed" | "no_comments" | "failed";

export interface FirstCommentRecord {
  streamKey: string;
  streamId: string | null;
  videoId: string | null;
  streamTitle: string;
  streamStartedAt: string;
  commentOffsetSeconds: number | null;
  commentedAt: string;
  authorName: string;
  authorDisplayName: string;
  messageText: string;
  source: FirstCommentSource;
}

export interface UserFirstCommentRecord {
  authorName: string;
  authorDisplayName: string;
  firstCommentedAt: string;
  messageText: string;
  source: FirstCommentSource;
  videoId: string | null;
  streamId: string | null;
  streamTitle: string;
  streamStartedAt: string;
  commentOffsetSeconds: number | null;
}

export interface ArchiveVideoProcessRecord {
  videoId: string;
  streamId: string | null;
  status: ArchiveBackfillStatus;
  commentsScanned?: number;
  errorMessage?: string | null;
}

interface FirstCommentRow {
  stream_key: string;
  stream_id: string | null;
  video_id: string | null;
  stream_title: string;
  stream_started_at: string;
  comment_offset_seconds: number | null;
  commented_at: string;
  author_name: string;
  author_display_name: string;
  message_text: string;
  source: FirstCommentSource;
}

interface UserFirstCommentRow {
  author_key: string;
  author_name: string;
  author_display_name: string;
  first_commented_at: string;
  message_text: string;
  source: FirstCommentSource;
  video_id: string | null;
  stream_id: string | null;
  stream_title: string;
  stream_started_at: string;
  comment_offset_seconds: number | null;
}

interface ArchiveVideoProcessRow {
  video_id: string;
  stream_id: string | null;
  status: ArchiveBackfillStatus;
  comments_scanned: number;
  error_message: string | null;
}

export class FirstCommentStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath, { timeout: 5000 });
    this.initialize();
  }

  saveFirstComment(record: FirstCommentRecord): boolean {
    const result = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO first_comments (
          stream_key,
          stream_id,
          video_id,
          stream_title,
          stream_started_at,
          comment_offset_seconds,
          commented_at,
          author_name,
          author_display_name,
          message_text,
          source,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `
      )
      .run(
        record.streamKey,
        record.streamId,
        record.videoId,
        record.streamTitle,
        record.streamStartedAt,
        record.commentOffsetSeconds,
        record.commentedAt,
        record.authorName,
        record.authorDisplayName,
        record.messageText,
        record.source
      );

    return Number(result.changes) > 0;
  }

  getByStreamKey(streamKey: string): FirstCommentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM first_comments WHERE stream_key = ?")
      .get(streamKey) as FirstCommentRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  getByStreamId(streamId: string): FirstCommentRecord | null {
    const row = this.db
      .prepare("SELECT * FROM first_comments WHERE stream_id = ?")
      .get(streamId) as FirstCommentRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  getLatest(): FirstCommentRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT *
        FROM first_comments
        ORDER BY commented_at DESC, created_at DESC
        LIMIT 1
      `
      )
      .get() as FirstCommentRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  saveUserFirstComment(record: UserFirstCommentRecord): boolean {
    const authorKey = normalizeAuthorKey(record.authorName);
    if (!authorKey) return false;

    const result = this.db
      .prepare(
        `
        INSERT INTO user_first_comments (
          author_key,
          author_name,
          author_display_name,
          first_commented_at,
          message_text,
          source,
          video_id,
          stream_id,
          stream_title,
          stream_started_at,
          comment_offset_seconds,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(author_key) DO UPDATE SET
          author_name = excluded.author_name,
          author_display_name = excluded.author_display_name,
          first_commented_at = excluded.first_commented_at,
          message_text = excluded.message_text,
          source = excluded.source,
          video_id = excluded.video_id,
          stream_id = excluded.stream_id,
          stream_title = excluded.stream_title,
          stream_started_at = excluded.stream_started_at,
          comment_offset_seconds = excluded.comment_offset_seconds,
          updated_at = datetime('now')
        WHERE excluded.first_commented_at < user_first_comments.first_commented_at
      `
      )
      .run(
        authorKey,
        authorKey,
        record.authorDisplayName || record.authorName,
        record.firstCommentedAt,
        record.messageText,
        record.source,
        record.videoId,
        record.streamId,
        record.streamTitle,
        record.streamStartedAt,
        record.commentOffsetSeconds
      );

    return Number(result.changes) > 0;
  }

  getUserFirstComment(authorName: string): UserFirstCommentRecord | null {
    const authorKey = normalizeAuthorKey(authorName);
    if (!authorKey) return null;

    const row = this.db
      .prepare("SELECT * FROM user_first_comments WHERE author_key = ?")
      .get(authorKey) as UserFirstCommentRow | undefined;
    return row ? userRowToRecord(row) : null;
  }

  markArchiveVideoProcessed(record: ArchiveVideoProcessRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO archive_comment_backfill_status (
          video_id,
          stream_id,
          status,
          comments_scanned,
          error_message,
          processed_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(video_id) DO UPDATE SET
          stream_id = excluded.stream_id,
          status = excluded.status,
          comments_scanned = excluded.comments_scanned,
          error_message = excluded.error_message,
          processed_at = excluded.processed_at,
          updated_at = datetime('now')
      `
      )
      .run(
        record.videoId,
        record.streamId,
        record.status,
        record.commentsScanned ?? 0,
        record.errorMessage ?? null
      );
  }

  isArchiveVideoProcessed(videoId: string): boolean {
    const status = this.getArchiveVideoStatus(videoId);
    return status?.status === "completed" || status?.status === "no_comments";
  }

  getArchiveVideoStatus(videoId: string): ArchiveVideoProcessRecord | null {
    const row = this.db
      .prepare(
        "SELECT video_id, stream_id, status, comments_scanned, error_message FROM archive_comment_backfill_status WHERE video_id = ?"
      )
      .get(videoId) as ArchiveVideoProcessRow | undefined;

    return row
      ? {
          videoId: row.video_id,
          streamId: row.stream_id,
          status: row.status,
          commentsScanned: row.comments_scanned,
          errorMessage: row.error_message,
        }
      : null;
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS first_comments (
        stream_key TEXT PRIMARY KEY,
        stream_id TEXT,
        video_id TEXT,
        stream_title TEXT NOT NULL,
        stream_started_at TEXT NOT NULL,
        comment_offset_seconds REAL,
        commented_at TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_display_name TEXT NOT NULL,
        message_text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('archive', 'live')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_first_comments_stream_id
        ON first_comments(stream_id)
        WHERE stream_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_first_comments_commented_at
        ON first_comments(commented_at);

      CREATE TABLE IF NOT EXISTS user_first_comments (
        author_key TEXT PRIMARY KEY,
        author_name TEXT NOT NULL,
        author_display_name TEXT NOT NULL,
        first_commented_at TEXT NOT NULL,
        message_text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('archive', 'live')),
        video_id TEXT,
        stream_id TEXT,
        stream_title TEXT NOT NULL,
        stream_started_at TEXT NOT NULL,
        comment_offset_seconds REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_user_first_comments_first_commented_at
        ON user_first_comments(first_commented_at);

      CREATE TABLE IF NOT EXISTS archive_comment_backfill_status (
        video_id TEXT PRIMARY KEY,
        stream_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('completed', 'no_comments', 'failed')),
        comments_scanned INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        processed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);

    // 旧仕様の「配信ごとの先頭コメント」は新仕様では使わないため削除する。
    this.db.exec(`
      DELETE FROM first_comments;
      DELETE FROM user_first_comments WHERE source = 'archive';
      DELETE FROM archive_comment_backfill_status;
    `);
  }
}

function rowToRecord(row: FirstCommentRow): FirstCommentRecord {
  return {
    streamKey: row.stream_key,
    streamId: row.stream_id,
    videoId: row.video_id,
    streamTitle: row.stream_title,
    streamStartedAt: row.stream_started_at,
    commentOffsetSeconds: row.comment_offset_seconds,
    commentedAt: row.commented_at,
    authorName: row.author_name,
    authorDisplayName: row.author_display_name,
    messageText: row.message_text,
    source: row.source,
  };
}

function userRowToRecord(row: UserFirstCommentRow): UserFirstCommentRecord {
  return {
    authorName: row.author_name,
    authorDisplayName: row.author_display_name,
    firstCommentedAt: row.first_commented_at,
    messageText: row.message_text,
    source: row.source,
    videoId: row.video_id,
    streamId: row.stream_id,
    streamTitle: row.stream_title,
    streamStartedAt: row.stream_started_at,
    commentOffsetSeconds: row.comment_offset_seconds,
  };
}

function normalizeAuthorKey(authorName: string): string {
  return authorName.trim().replace(/^@/, "").toLowerCase();
}
