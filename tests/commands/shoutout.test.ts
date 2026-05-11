import { describe, expect, it, vi } from "vitest";
import { sendShoutout } from "../../src/commands/shoutout";

describe("sendShoutout", () => {
  it("executes shoutout in the moderator user context", async () => {
    const getUserByName = vi.fn().mockResolvedValue({ id: "raider-id" });
    const shoutoutUser = vi.fn().mockResolvedValue(undefined);
    const asUser = vi.fn(async (userId: string, runner: (ctx: unknown) => Promise<void>) => {
      await runner({
        chat: { shoutoutUser },
      });
      return undefined;
    });

    await sendShoutout(
      {
        users: { getUserByName },
        asUser,
      },
      {
        broadcasterId: "broadcaster-id",
        moderatorUserId: "bot-user-id",
        targetUsername: "yunma_flw",
      }
    );

    expect(getUserByName).toHaveBeenCalledWith("yunma_flw");
    expect(asUser).toHaveBeenCalledWith("bot-user-id", expect.any(Function));
    expect(shoutoutUser).toHaveBeenCalledWith("broadcaster-id", "raider-id");
  });

  it("skips API shoutout when the raid user cannot be resolved", async () => {
    const shoutoutUser = vi.fn();
    const asUser = vi.fn();

    await sendShoutout(
      {
        users: { getUserByName: vi.fn().mockResolvedValue(null) },
        asUser,
      },
      {
        broadcasterId: "broadcaster-id",
        moderatorUserId: "bot-user-id",
        targetUsername: "missing_user",
      }
    );

    expect(asUser).not.toHaveBeenCalled();
    expect(shoutoutUser).not.toHaveBeenCalled();
  });
});
