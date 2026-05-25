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

export interface FetchFirstCommentOptions {
  videoCreatedAt: string;
}

type FetchFn = typeof fetch;

interface TwitchVodCommentsClientOptions {
  clientId?: string;
  fetchFn?: FetchFn;
}

interface GqlCommentEdge {
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
    const response = await this.fetchFn(GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          operationName: "VideoCommentsByOffsetOrCursor",
          variables: {
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
    const edge = data[0]?.data?.video?.comments?.edges?.[0];
    if (!edge?.node) return null;

    return parseFirstComment(edge, options.videoCreatedAt);
  }
}

function parseFirstComment(
  edge: GqlCommentEdge,
  videoCreatedAt: string
): VodFirstComment | null {
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
