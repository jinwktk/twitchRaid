import type { ApiClient } from "@twurple/api";
import { isShoutoutAdmin } from "./shoutout";

export interface ManualStreamNotificationStream {
  id: string;
  title: string;
  userDisplayName?: string;
  gameName?: string;
  viewers?: number;
  thumbnailUrl?: string;
  getThumbnailUrl?: (width: number, height: number) => string;
  startDate: Date;
}

export interface ManualStreamNotificationApi {
  streams: Pick<ApiClient["streams"], "getStreamByUserName">;
}

export type ManualStreamNotificationResult =
  | { status: "posted"; title: string }
  | { status: "offline" }
  | { status: "failed"; title: string; error: unknown };

export function isStreamNotifyAdmin(
  userName: string | undefined,
  adminUsers: string[],
  isMod: boolean,
  isBroadcaster: boolean
): boolean {
  return isShoutoutAdmin(userName, adminUsers, isMod, isBroadcaster);
}

export async function sendManualStreamNotification({
  apiClient,
  loginChannel,
  postNotification,
}: {
  apiClient: ManualStreamNotificationApi;
  loginChannel: string;
  postNotification: (
    stream: ManualStreamNotificationStream
  ) => Promise<void>;
}): Promise<ManualStreamNotificationResult> {
  const stream = await apiClient.streams.getStreamByUserName(loginChannel);
  if (!stream) return { status: "offline" };

  try {
    await postNotification(stream);
    return { status: "posted", title: stream.title };
  } catch (error) {
    return { status: "failed", title: stream.title, error };
  }
}
