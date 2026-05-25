const GQL_URL = "https://gql.twitch.tv/gql";
const DEFAULT_GQL_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const VIDEO_COMMENTS_QUERY_HASH =
  "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

export interface VodFirstComment {
  offsetSeconds: number;
  commentedAt: string;
  authorName: string;
  authorDisplayName: string;
  messageText: string;
}

export type VodComment = VodFirstComment;

export interface FetchFirstCommentOptions {
  videoCreatedAt: string;
}

type FetchFn = typeof fetch;

interface TwitchVodCommentsClientOptions {
  clientId?: string;
  fetchFn?: FetchFn;
}

interface GqlCommentEdge {
  cursor?: string;
  node?: {
    contentOffsetSeconds?: number;
    createdAt?: string;
    commenter?: {
      login?: string;
      displayName?: string;
    } | null;
    message?: {
      fragments?: Array<{
        text?: string;
      }>;
    };
  };
}

interface GqlVideoCommentsResponse {
  data?: {
    video?: {
      comments?: {
        edges?: GqlCommentEdge[];
        pageInfo?: {
          hasNextPage?: boolean;
        };
      };
    } | null;
  };
}

export class TwitchVodCommentsClient {
  private readonly clientId: string;
  private readonly fetchFn: FetchFn;

  constructor(options: TwitchVodCommentsClientOptions = {}) {
    this.clientId =
      options.clientId ?? process.env["TWITCH_GQL_CLIENT_ID"] ?? DEFAULT_GQL_CLIENT_ID;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async fetchFirstComment(
    videoId: string,
    options: FetchFirstCommentOptions
  ): Promise<VodFirstComment | null> {
    const comments = await this.fetchComments(videoId, options);
    return comments[0] ?? null;
  }

  async fetchComments(
    videoId: string,
    options: FetchFirstCommentOptions
  ): Promise<VodComment[]> {
    const comments: VodComment[] = [];
    let cursor: string | null = null;

    do {
      const page = await this.fetchCommentsPage(videoId, options, cursor);
      comments.push(...page.comments);
      cursor = page.nextCursor;
    } while (cursor);

    return comments;
  }

  private async fetchCommentsPage(
    videoId: string,
    options: FetchFirstCommentOptions,
    cursor: string | null
  ): Promise<{ comments: VodComment[]; nextCursor: string | null }> {
    const response = await this.fetchFn(GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          operationName: "VideoCommentsByOffsetOrCursor",
          variables: cursor
            ? {
                videoID: videoId,
                cursor,
              }
            : {
                videoID: videoId,
                contentOffsetSeconds: 0,
              },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: VIDEO_COMMENTS_QUERY_HASH,
            },
          },
        },
      ]),
    });

    if (!response.ok) {
      throw new Error(`Twitch GQL comments request failed: ${response.status}`);
    }

    const data = (await response.json()) as GqlVideoCommentsResponse[];
    const commentsData = data[0]?.data?.video?.comments;
    const edges = commentsData?.edges ?? [];
    const comments = edges
      .map((edge) => parseComment(edge, options.videoCreatedAt))
      .filter((comment): comment is VodComment => comment !== null);
    const lastCursor = edges.at(-1)?.cursor ?? null;
    const nextCursor = commentsData?.pageInfo?.hasNextPage ? lastCursor : null;

    return {
      comments,
      nextCursor,
    };
  }
}

function parseComment(
  edge: GqlCommentEdge,
  videoCreatedAt: string
): VodComment | null {
  const node = edge.node;
  if (!node) return null;

  const messageText =
    node.message?.fragments?.map((fragment) => fragment.text ?? "").join("") ??
    "";
  const normalizedMessage = messageText.trim();
  if (!normalizedMessage) return null;

  const offsetSeconds = node.contentOffsetSeconds ?? 0;
  return {
    offsetSeconds,
    commentedAt:
      node.createdAt ?? isoFromOffset(videoCreatedAt, offsetSeconds),
    authorName: node.commenter?.login ?? "unknown",
    authorDisplayName:
      node.commenter?.displayName ?? node.commenter?.login ?? "unknown",
    messageText: normalizedMessage,
  };
}

function isoFromOffset(videoCreatedAt: string, offsetSeconds: number): string {
  const timestamp = new Date(videoCreatedAt).getTime() + offsetSeconds * 1000;
  return new Date(timestamp).toISOString();
}
