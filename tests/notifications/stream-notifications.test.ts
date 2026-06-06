import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config";
import { StreamTitleNotifier } from "../../src/notifications/stream-notifications";

function fakeConfig(lastTitle = ""): Config {
  return {
    loginChannel: "rukalun",
    getLastStreamTitle: vi.fn(() => lastTitle),
    updateLastStreamTitle: vi.fn(),
  } as unknown as Config;
}

describe("StreamTitleNotifier", () => {
  it("builds stream-start messages with the stream URL", () => {
    const notifier = new StreamTitleNotifier(fakeConfig(), "rukalun");

    expect(notifier.buildMessage("新しいタイトル")).toBe(
      "新しいタイトル\n🔴 配信URL: https://www.twitch.tv/rukalun"
    );
  });

  it("sends the stream URL while storing only the normalized title", async () => {
    const config = fakeConfig();
    const notifier = new StreamTitleNotifier(config, "rukalun");
    const sender = vi.fn();

    await notifier.notifyIfNeeded("  新しいタイトル  ", sender);

    expect(sender).toHaveBeenCalledWith(
      "新しいタイトル\n🔴 配信URL: https://www.twitch.tv/rukalun"
    );
    expect(config.updateLastStreamTitle).toHaveBeenCalledWith("新しいタイトル");
  });
});
