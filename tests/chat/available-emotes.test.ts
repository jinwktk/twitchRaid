import { afterEach, describe, expect, it, vi } from "vitest";
import { TwitchAvailableEmotesClient } from "../../src/chat/available-emotes";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TwitchAvailableEmotesClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches every page and preserves emote metadata", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "1",
              name: "rukkaOhanyo",
              emote_type: "follower",
              tier: "",
              emote_set_id: "set-1",
              owner_id: "channel-1",
              format: ["static"],
              scale: ["1.0", "2.0"],
              theme_mode: ["light", "dark"],
            },
          ],
          pagination: { cursor: "next-page" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: "2",
              name: "rukkaNnn",
              emote_type: "follower",
              tier: "",
              emote_set_id: "set-1",
              owner_id: "channel-1",
              format: ["static", "animated"],
              scale: ["1.0"],
              theme_mode: ["dark"],
            },
          ],
          pagination: {},
        })
      );
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "secret-token",
      getClientId: () => "client-id",
      fetchImpl,
    });

    await expect(client.getAvailableEmotes("bot-1", "channel-1")).resolves.toEqual([
      {
        id: "1",
        name: "rukkaOhanyo",
        emoteType: "follower",
        tier: "",
        emoteSetId: "set-1",
        ownerId: "channel-1",
        format: ["static"],
        scale: ["1.0", "2.0"],
        themeMode: ["light", "dark"],
      },
      {
        id: "2",
        name: "rukkaNnn",
        emoteType: "follower",
        tier: "",
        emoteSetId: "set-1",
        ownerId: "channel-1",
        format: ["static", "animated"],
        scale: ["1.0"],
        themeMode: ["dark"],
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0];
    expect(String(firstUrl)).toBe(
      "https://api.twitch.tv/helix/chat/emotes/user?user_id=bot-1&broadcaster_id=channel-1"
    );
    expect(firstInit?.headers).toEqual({
      Authorization: "Bearer secret-token",
      "Client-Id": "client-id",
    });
    expect(String(fetchImpl.mock.calls[1][0])).toContain("after=next-page");
  });

  it("shares in-flight requests, caches success, and refreshes after expiry", async () => {
    let now = 1_000;
    let resolveFetch!: (value: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
      now: () => now,
      cacheTtlMs: 300_000,
    });

    const first = client.getAvailableEmotes("bot", "channel");
    const second = client.getAvailableEmotes("bot", "channel");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    resolveFetch(
      jsonResponse({ data: [{ id: "1", name: "rukkaNnn", emote_type: "follower" }], pagination: {} })
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: "1", name: "rukkaNnn", emoteType: "follower" }],
      [{ id: "1", name: "rukkaNnn", emoteType: "follower" }],
    ]);

    await client.getAvailableEmotes("bot", "channel");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 300_001;
    fetchImpl.mockResolvedValueOnce(jsonResponse({ data: [], pagination: {} }));
    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("drops expired subscription emotes and restores them after a later renewal refresh", async () => {
    let now = 20_000;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "sub-1", name: "rukkaGg", emote_type: "subscriptions", tier: "1000" },
            { id: "follow-1", name: "rukkaOhanyo", emote_type: "follower", tier: "" },
          ],
          pagination: {},
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "follow-1", name: "rukkaOhanyo", emote_type: "follower", tier: "" },
          ],
          pagination: {},
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "sub-1", name: "rukkaGg", emote_type: "subscriptions", tier: "1000" },
            { id: "follow-1", name: "rukkaOhanyo", emote_type: "follower", tier: "" },
          ],
          pagination: {},
        })
      );
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
      now: () => now,
      cacheTtlMs: 300_000,
    });

    expect(
      (await client.getAvailableEmotes("bot", "channel")).map((emote) => emote.name)
    ).toEqual(["rukkaGg", "rukkaOhanyo"]);

    now += 300_001;
    expect(
      (await client.getAvailableEmotes("bot", "channel")).map((emote) => emote.name)
    ).toEqual(["rukkaOhanyo"]);

    now += 300_001;
    expect(
      (await client.getAvailableEmotes("bot", "channel")).map((emote) => emote.name)
    ).toEqual(["rukkaGg", "rukkaOhanyo"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails closed for rejected and invalid responses and applies a short backoff", async () => {
    let now = 10_000;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("request failed with secret response"))
      .mockResolvedValueOnce(jsonResponse({ data: "invalid", pagination: {} }));
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
      now: () => now,
      failureBackoffMs: 10_000,
    });

    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 10_001;
    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Twitch rejects the request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: "token detail must not be consumed" }, 401)
    );
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
    });

    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("aborts the whole pagination request at the deadline", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
      timeoutMs: 5_000,
    });

    const result = client.getAvailableEmotes("bot", "channel");
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(result).resolves.toEqual([]);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("applies the same deadline while waiting for credential providers", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => new Promise<string>(() => undefined),
      getClientId: () => "client",
      fetchImpl,
      timeoutMs: 5_000,
    });

    const result = client.getAvailableEmotes("bot", "channel");
    await vi.advanceTimersByTimeAsync(5_001);
    await expect(result).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on cursor loops and page limits", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ id: "1", name: "rukkaNnn", emote_type: "follower" }],
        pagination: { cursor: "same" },
      })
    );
    const client = new TwitchAvailableEmotesClient({
      getAccessToken: () => "token",
      getClientId: () => "client",
      fetchImpl,
      maxPages: 2,
    });

    await expect(client.getAvailableEmotes("bot", "channel")).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
