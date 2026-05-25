import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

export type FirstCommentSource = "archive" | "live";

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
