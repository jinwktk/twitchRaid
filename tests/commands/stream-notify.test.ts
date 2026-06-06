import { describe, expect, it, vi } from "vitest";
import {
  isStreamNotifyAdmin,
  sendManualStreamNotification,
} from "../../src/commands/stream-notify";

const liveStream = {
  id: "stream-id",
  title: "配信タイトル",
  gameName: "FINAL FANTASY XIV ONLINE",
  startDate: new Date("2026-06-06T01:05:28.000Z"),
};

describe("isStreamNotifyAdmin", () => {
  it("allows broadcaster, moderators, and configured admins", () => {
    expect(isStreamNotifyAdmin("viewer", [], false, true)).toBe(true);
    expect(isStreamNotifyAdmin("viewer", [], true, false)).toBe(true);
    expect(isStreamNotifyAdmin("RukaLun", ["rukalun"], false, false)).toBe(true);
  });

  it("denies regular viewers", () => {
    expect(isStreamNotifyAdmin("viewer", ["rukalun"], false, false)).toBe(false);
  });
});

describe("sendManualStreamNotification", () => {
  it("posts the current live stream notification", async () => {
    const getStreamByUserName = vi.fn().mockResolvedValue(liveStream);
    const postNotification = vi.fn().mockResolvedValue(undefined);

    const result = await sendManualStreamNotification({
      apiClient: { streams: { getStreamByUserName } },
      loginChannel: "rukalun",
      postNotification,
    });

    expect(getStreamByUserName).toHaveBeenCalledWith("rukalun");
    expect(postNotification).toHaveBeenCalledWith(liveStream);
    expect(result).toEqual({ status: "posted", title: "配信タイトル" });
  });

  it("returns offline when there is no current stream", async () => {
    const postNotification = vi.fn();

    const result = await sendManualStreamNotification({
      apiClient: {
        streams: { getStreamByUserName: vi.fn().mockResolvedValue(null) },
      },
      loginChannel: "rukalun",
      postNotification,
    });

    expect(postNotification).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "offline" });
  });

  it("returns failed when Discord posting fails", async () => {
    const error = new Error("Discord bot message failed: 403");

    const result = await sendManualStreamNotification({
      apiClient: {
        streams: { getStreamByUserName: vi.fn().mockResolvedValue(liveStream) },
      },
      loginChannel: "rukalun",
      postNotification: vi.fn().mockRejectedValue(error),
    });

    expect(result).toEqual({
      status: "failed",
      title: "配信タイトル",
      error,
    });
  });
});
