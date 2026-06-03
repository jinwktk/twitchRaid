import { ChatClient, ChatMessage } from "@twurple/chat";
import { ApiClient } from "@twurple/api";
import { RefreshingAuthProvider } from "@twurple/auth";
import type { Config } from "./config";
import logger from "./utils/logger";
import { StreamTitleNotifier } from "./notifications/stream-notifications";
import { ClipRecastNotifier } from "./notifications/clip-recast-notifier";
import { CommentSpeedMeter } from "./chat/comment-speed-meter";
import { CommandCooldownState } from "./chat/command-cooldown-state";
import { isCommandMessage } from "./chat/message-filters";
import { formatTotalCommentCount } from "./chat/comment-count-formatter";
import {
  loadCommentState,
  saveCommentState,
} from "./utils/comment-state-store";
import { StreamSummaryStateStore } from "./streams/stream-summary-state-store";
import { postStreamSummary, startStreamSummaryThread } from "./streams/stream-summary";
import { refreshAccessTokenAdvanced } from "./auth/token-manager";
import {
  clipHistoryKey,
  resolveClipCreatorId,
  selectCachedClip,
  selectClip,
  type ClipCommandName,
} from "./commands/clip";
import { ClipCacheStore } from "./commands/clip-cache-store";
import { ClipCacheSynchronizer } from "./commands/clip-cache-sync";
import {
  isShoutoutAdmin,
  normalizeShoutoutTarget,
  sendShoutout,
} from "./commands/shoutout";
import { calculateAge } from "./commands/age";
import {
  fetchRandomMangaTitle,
  isMangaAdmin,
} from "./commands/manga";
import {
  randomWeight,
  randomHeight,
  randomMood,
  randomMenu,
} from "./commands/random-commands";
import {
  BoomSummaryCache,
  buildBoomSummary,
  formatBoomSummary,
} from "./commands/boom";
import { restartProcess } from "./utils/process-restart";


const MANGA_DELETE_DELAY_SECONDS = 10;

export class Bot {
  private readonly config: Config;
  private chatClient!: ChatClient;
  private apiClient!: ApiClient;
  private authProvider!: RefreshingAuthProvider;

  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private streamLive = false;
  private botUserId = "";

  private readonly streamNotifier: StreamTitleNotifier;
  private readonly recastNotifiers: Record<string, ClipRecastNotifier>;
  private readonly commandCooldownState: CommandCooldownState;
  private readonly commentSpeedMeter: CommentSpeedMeter;
  private readonly clipCacheStore: ClipCacheStore;
  private readonly streamSummaryStateStore: StreamSummaryStateStore;
  private readonly boomSummaryCache = new BoomSummaryCache();
  private clipCacheSynchronizer: ClipCacheSynchronizer | null = null;

  // Keep-alive timers
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private streamMonitorTimer: ReturnType<typeof setInterval> | null = null;

  // コメント状態保存デバウンス
  private commentSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly commentSaveDebounceMs = 30_000; // 30秒

  constructor(config: Config) {
    this.config = config;
    this.streamNotifier = new StreamTitleNotifier(
      config,
      config.loginChannel
    );
    this.recastNotifiers = {
      clip: new ClipRecastNotifier(
        1800,
        "⏱️ `clip` コマンドのリキャストが戻りました！もう一度 `!clip` でクリップできます。"
      ),
      myclip: new ClipRecastNotifier(
        1800,
        "⏱️ `myclip` コマンドのリキャストが戻りました！もう一度 `!myclip` でクリップできます。"
      ),
    };
    this.commandCooldownState = new CommandCooldownState({
      clip: config.lastClipTime,
      myclip: config.lastMyclipTime,
    });
    this.commentSpeedMeter = new CommentSpeedMeter(60);
    this.clipCacheStore = new ClipCacheStore(config.clipCacheDbPath);
    this.streamSummaryStateStore = new StreamSummaryStateStore(
      config.streamSummaryStatePath
    );

    // コメント状態復元
    const [totalCount, streamStartedAt] = loadCommentState(config.envFile);
    this.commentSpeedMeter.setState(streamStartedAt, totalCount);
    const summaryState = this.streamSummaryStateStore.load();
    if (
      streamStartedAt === 0 &&
      summaryState &&
      summaryState.status !== "posted"
    ) {
      this.commentSpeedMeter.setState(
        Date.parse(summaryState.startedAt) / 1000,
        summaryState.commentCount
      );
    }
  }

  async start(): Promise<void> {
    // AuthProvider設定
    this.authProvider = new RefreshingAuthProvider({
      clientId: this.config.twitchClientId,
      clientSecret: this.config.twitchSecretToken,
    });

    this.authProvider.onRefresh(async (_userId, newTokenData) => {
      logger.info("🔄 トークンが自動リフレッシュされました。");
      this.config.updateAccessToken(
        newTokenData.accessToken,
        newTokenData.refreshToken ?? this.config.twitchRefreshToken
      );
    });

    this.botUserId = await this.authProvider.addUserForToken(
      {
        accessToken: this.config.twitchAccessToken,
        refreshToken: this.config.twitchRefreshToken,
        expiresIn: null,
        obtainmentTimestamp: Date.now(),
        scope: this.config.activeAuthScopes,
      },
      ["chat", "api"]
    );
    logger.info(`🔑 Botユーザー登録完了: userId=${this.botUserId}`);

    // API Client
    this.apiClient = new ApiClient({ authProvider: this.authProvider });
    this.clipCacheSynchronizer = new ClipCacheSynchronizer({
      apiClient: this.apiClient,
      broadcasterId: this.config.twitchBroadcasterId,
      store: this.clipCacheStore,
    });
    this.clipCacheSynchronizer.start();

    // Chat Client
    this.chatClient = new ChatClient({
      authProvider: this.authProvider,
      channels: [this.config.loginChannel],
    });

    this._setupEventHandlers();
    // twurple v7 の ChatClient.connect() は同期的に void を返し、
    // 接続完了は onConnect イベントで通知される。await は不要。
    this.chatClient.connect();

    logger.info("✅ Bot起動準備完了。チャット接続を待機中...");
  }

  async stop(): Promise<void> {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.streamMonitorTimer) clearInterval(this.streamMonitorTimer);
    if (this.commentSaveTimer) clearTimeout(this.commentSaveTimer);
    // 停止前にコメント状態を即座に保存
    this._flushCommentState();
    await this.clipCacheSynchronizer?.stop();
    this.clipCacheStore.close();
    this.chatClient.quit();
  }

  private _setupEventHandlers(): void {
    this.chatClient.onConnect(() => {
      logger.info("✅ 全てのチャンネルにログインしました。");
      this.reconnectAttempts = 0;
      this._startKeepAlive();
      this._startStreamMonitor();
    });

    this.chatClient.onDisconnect((_manually, reason) => {
      logger.warn(`🔌 切断されました: ${reason ?? "不明"}`);
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(15 + this.reconnectAttempts * 5, 60) * 1000;
        logger.info(
          `🔄 再接続試行 (${this.reconnectAttempts}/${this.maxReconnectAttempts}) - ${delay / 1000}秒後...`
        );
        setTimeout(() => this.chatClient.connect(), delay);
      } else {
        logger.error("🚨 最大再接続試行回数到達。プロセス再起動...");
        restartProcess();
      }
    });

    this.chatClient.onMessage(async (channel, user, text, msg) => {
      if (!text) return;

      logger.debug(`メッセージ受信: ${user}: ${text}`);

      const isCommand = isCommandMessage(text, this.config.commandPrefix);
      if (isCommand) {
        logger.info(`🤖 コマンド検出: ${text}`);
        await this._handleCommand(channel, user, text, msg);
      } else {
        const now = Date.now() / 1000;
        this.commentSpeedMeter.record(now);
        this._debouncedSaveCommentState();
        this._persistStreamSummaryCounts();
      }
    });

    this.chatClient.onJoin((_channel, user) => {
      logger.debug(`ユーザー参加: ${user}`);
    });

    // レイドイベント
    this.chatClient.onRaid(async (_channel, user, raidInfo) => {
      logger.info(
        `Raid detected from ${user}. Viewers: ${raidInfo.viewerCount}. Sending shoutout.`
      );
      this._incrementStreamSummaryRaid();
      await this._sendShoutout(user);
    });
  }

  private async _handleCommand(
    channel: string,
    user: string,
    text: string,
    msg: ChatMessage
  ): Promise<void> {
    const args = text.slice(this.config.commandPrefix.length).split(/\s+/);
    const cmd = args[0].toLowerCase();

    switch (cmd) {
      case "age":
        await this.chatClient.say(channel, String(calculateAge()));
        break;
      case "goods":
        await this.chatClient.say(channel, "https://rukalun.booth.pm");
        break;
      case "weight":
        await this.chatClient.say(channel, randomWeight());
        break;
      case "height":
        await this.chatClient.say(channel, randomHeight());
        break;
      case "mood":
        await this.chatClient.say(channel, randomMood());
        break;
      case "menu":
        await this.chatClient.say(channel, randomMenu());
        break;
      case "speed":
        await this._handleSpeedCommand(channel);
        break;
      case "commentcount":
        await this._handleCommentCountCommand(channel);
        break;
      case "boom":
        await this._handleBoomCommand(channel);
        break;
      case "clip":
        await this._handleClipCommand(channel, user, "clip");
        break;
      case "myclip":
        await this._handleClipCommand(channel, user, "myclip", user);
        break;
      case "manga":
        await this._handleMangaCommand(channel, user);
        break;
      case "mangaon":
        await this._handleMangaToggle(channel, user, msg, true);
        break;
      case "mangaoff":
        await this._handleMangaToggle(channel, user, msg, false);
        break;
      case "shoutout":
        await this._handleShoutoutCommand(channel, user, args[1], msg);
        break;
      default:
        break;
    }
  }

  private async _handleSpeedCommand(channel: string): Promise<void> {
    const now = Date.now() / 1000;
    const rate = this.commentSpeedMeter.ratePerMinute(now);
    const count = this.commentSpeedMeter.count(now);
    const totalRate = this.commentSpeedMeter.totalRatePerMinute(now);
    const totalCount = this.commentSpeedMeter.totalCount();
    await this.chatClient.say(
      channel,
      `コメント風速: 直近60秒 ${rate}/分 (${count}件) / 配信全体 ${totalRate}/分 (${totalCount}件)`
    );
  }

  private async _handleCommentCountCommand(channel: string): Promise<void> {
    const totalCount = this.commentSpeedMeter.totalCount();
    await this.chatClient.say(channel, formatTotalCommentCount(totalCount));
  }

  private async _handleBoomCommand(channel: string): Promise<void> {
    try {
      const summary = await this.boomSummaryCache.getOrLoad(() =>
        buildBoomSummary(this.apiClient, {
          broadcasterId: this.config.twitchBroadcasterId,
          gqlClientId: this.config.twitchGqlClientId,
        })
      );
      await this.chatClient.say(channel, formatBoomSummary(summary));
    } catch (e) {
      logger.error(`❌ boom集計失敗: ${e}`);
      await this.chatClient.say(
        channel,
        "⚠️ 最近配信したゲーム時間の取得に失敗しました。時間をおいて再試行してください。"
      );
    }
  }

  private async _handleClipCommand(
    channel: string,
    user: string,
    commandName: ClipCommandName,
    creatorName?: string
  ): Promise<void> {
    const notifier = this.recastNotifiers[commandName];
    const isSpecialUser = this.config.clipSpecialUsers.includes(
      user.toLowerCase()
    );
    const now = Date.now() / 1000;
    const remaining = this.commandCooldownState.remainingSeconds(
      commandName,
      now,
      1800
    );

    if (!isSpecialUser && remaining > 0) {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      await this.chatClient.say(
        channel,
        `⚠️ \`${commandName}\` コマンドは 30分に1回のみ使用できます。あと ${mins}分 ${secs}秒 待ってください。`
      );
      const lastUsed = this.commandCooldownState.lastUsed(commandName);
      if (lastUsed !== null) {
        notifier.arm(lastUsed, (msg) => this.chatClient.say(channel, msg));
      }
      return;
    }

    this.clipCacheSynchronizer?.syncRecentIfStale();
    const historyKey = clipHistoryKey(commandName, creatorName);
    const creatorId = creatorName
      ? await resolveClipCreatorId(this.apiClient, creatorName) ?? undefined
      : undefined;
    let clip = selectCachedClip(
      this.clipCacheStore,
      commandName,
      creatorName,
      creatorId
    );

    if (!clip) {
      clip = await selectClip(
        this.apiClient,
        this.config.twitchBroadcasterId,
        creatorId,
        creatorName,
        {
          recentClipIds: this.clipCacheStore.getRecentIds(historyKey),
          maxFetch: 200,
        }
      );
    }

    if (clip) {
      await this.chatClient.say(channel, clip.url);
      this.clipCacheStore.recordHistory(historyKey, clip.id);
      if (!isSpecialUser) {
        this.commandCooldownState.markUsed(commandName, now);
        this._persistCommandCooldown(commandName, now);
        notifier.arm(now, (msg) => this.chatClient.say(channel, msg));
      }
    } else {
      if (creatorName) {
        await this.chatClient.say(
          channel,
          "⚠️ あなたが作成したクリップが見つかりませんでした。"
        );
      } else {
        await this.chatClient.say(
          channel,
          "⚠️ クリップが見つかりませんでした。"
        );
      }
    }
  }

  private async _handleMangaCommand(
    channel: string,
    _user: string
  ): Promise<void> {
    if (!this.config.mangaCommandEnabled) {
      await this._sendMangaReply(
        channel,
        "⚠️ `manga` コマンドは現在OFFです。"
      );
      return;
    }

    try {
      const manga = await fetchRandomMangaTitle();
      await this._sendMangaReply(
        channel,
        manga ? `今日のおすすめ漫画：${manga}` : "⚠️ 漫画が見つかりませんでした。"
      );
    } catch {
      await this._sendMangaReply(
        channel,
        "⚠️ 漫画ランキングの取得に失敗しました。時間をおいて再試行してください。"
      );
    }
  }

  private async _handleMangaToggle(
    channel: string,
    user: string,
    msg: ChatMessage,
    enable: boolean
  ): Promise<void> {
    const isMod = msg.userInfo.isMod;
    const isBroadcaster = msg.userInfo.isBroadcaster;

    if (!isMangaAdmin(user, this.config.mangaAdminUsers, isMod, isBroadcaster)) {
      await this.chatClient.say(
        channel,
        `⚠️ \`manga${enable ? "on" : "off"}\` は管理者のみ実行できます。`
      );
      return;
    }

    if (enable && this.config.mangaCommandEnabled) {
      await this.chatClient.say(
        channel,
        "ℹ️ `manga` コマンドはすでにONです。"
      );
      return;
    }
    if (!enable && !this.config.mangaCommandEnabled) {
      await this.chatClient.say(
        channel,
        "ℹ️ `manga` コマンドはすでにOFFです。"
      );
      return;
    }

    this.config.updateMangaCommandEnabled(enable);
    await this.chatClient.say(
      channel,
      `✅ \`manga\` コマンドを${enable ? "ON" : "OFF"}にしました。`
    );
  }

  private async _handleShoutoutCommand(
    channel: string,
    user: string,
    rawTarget: string | undefined,
    msg: ChatMessage
  ): Promise<void> {
    const isMod = msg.userInfo.isMod;
    const isBroadcaster = msg.userInfo.isBroadcaster;

    if (
      !isShoutoutAdmin(
        user,
        this.config.shoutoutAdminUsers,
        isMod,
        isBroadcaster
      )
    ) {
      await this.chatClient.say(
        channel,
        "⚠️ `shoutout` は管理者のみ実行できます。"
      );
      return;
    }

    const target = normalizeShoutoutTarget(rawTarget);
    if (!target) {
      await this.chatClient.say(channel, "⚠️ 使い方: !shoutout <ユーザー名>");
      return;
    }

    logger.info(`手動shoutout実行: operator=${user}, target=${target}`);
    const sent = await this._sendShoutout(target);
    await this.chatClient.say(
      channel,
      sent
        ? `✅ @${target} をshoutoutしました。`
        : `⚠️ @${target} のshoutoutに失敗しました。ログを確認してください。`
    );
  }

  private async _sendMangaReply(
    channel: string,
    content: string
  ): Promise<void> {
    try {
      if (!this.config.twitchBroadcasterId || !this.botUserId) {
        await this.chatClient.say(channel, content);
        return;
      }

      // Bot自身のユーザーコンテキストでAPI経由送信し、一定時間後に削除
      const result = await this.apiClient.asUser(this.botUserId, async (ctx) =>
        ctx.chat.sendChatMessage(this.config.twitchBroadcasterId, content)
      );

      const messageId = result?.id;
      if (messageId) {
        logger.info(
          `🗑️ ${MANGA_DELETE_DELAY_SECONDS}秒後にmanga返信を削除予約: message_id=${messageId}`
        );
        setTimeout(async () => {
          try {
            await this.apiClient.asUser(this.botUserId, async (ctx) =>
              ctx.moderation.deleteChatMessages(
                this.config.twitchBroadcasterId,
                messageId
              )
            );
          } catch (e) {
            logger.error(`❌ メッセージ削除失敗 (id=${messageId}): ${e}`);
          }
        }, MANGA_DELETE_DELAY_SECONDS * 1000);
      }
    } catch (e) {
      logger.error(`❌ manga返信のAPI送信失敗。chatClient.sayへフォールバック: ${e}`);
      await this.chatClient.say(channel, content);
    }
  }

  private async _sendShoutout(username: string): Promise<boolean> {
    try {
      if (!this.botUserId) {
        logger.warn("⚠️ BotユーザーID未取得のためshoutoutをスキップします。");
        return false;
      }

      const sent = await sendShoutout(this.apiClient, {
        broadcasterId: this.config.twitchBroadcasterId,
        moderatorUserId: this.botUserId,
        targetUsername: username,
      });
      if (!sent) {
        logger.warn(`⚠️ ユーザー ${username} が見つかりません。`);
        return false;
      }

      logger.info(`✅ Shoutout successfully sent to ${username}`);
      return true;
    } catch (e) {
      logger.error(`❌ Failed to send shoutout: ${e}`);
      // リトライ: AuthProvider内部のトークンを更新（apiClientと同一インスタンス）
      try {
        if (this.botUserId) {
          await this.authProvider.refreshAccessTokenForUser(this.botUserId);
        } else {
          await refreshAccessTokenAdvanced(this.config);
        }
        const sent = await sendShoutout(this.apiClient, {
          broadcasterId: this.config.twitchBroadcasterId,
          moderatorUserId: this.botUserId,
          targetUsername: username,
        });
        if (sent) {
          logger.info(`✅ Shoutout retry success for ${username}`);
          return true;
        } else {
          logger.warn(`⚠️ ユーザー ${username} が見つかりません。`);
        }
      } catch (retryErr) {
        logger.error(`❌ Shoutout retry failed: ${retryErr}`);
      }
      return false;
    }
  }

  private _persistCommandCooldown(
    commandName: string,
    timestamp: number
  ): void {
    if (commandName === "clip") {
      this.config.updateLastClipTime(timestamp);
    } else if (commandName === "myclip") {
      this.config.updateLastMyclipTime(timestamp);
    }
  }

  private _debouncedSaveCommentState(): void {
    if (this.commentSaveTimer) return; // 既にタイマーが動作中
    this.commentSaveTimer = setTimeout(() => {
      this.commentSaveTimer = null;
      this._flushCommentState();
    }, this.commentSaveDebounceMs);
  }

  private _flushCommentState(): void {
    saveCommentState(
      this.config.envFile,
      this.commentSpeedMeter.totalCount(),
      this.commentSpeedMeter.streamStartedAt() ?? 0
    );
  }

  private _persistStreamSummaryCounts(): void {
    const state = this.streamSummaryStateStore.load();
    if (!state || state.status === "posted") return;

    this.streamSummaryStateStore.updateCounts(
      this.commentSpeedMeter.totalCount(),
      state.raidCount
    );
  }

  private _incrementStreamSummaryRaid(): void {
    const state = this.streamSummaryStateStore.load();
    if (!state || state.status === "posted") return;

    this.streamSummaryStateStore.updateCounts(
      this.commentSpeedMeter.totalCount(),
      state.raidCount + 1
    );
  }

  private _startKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);

    const connectionCheckInterval = 45_000;
    const tokenRefreshInterval = 2 * 60 * 60; // 2時間（秒）
    let lastTokenRefresh = Date.now() / 1000;

    this.keepAliveTimer = setInterval(async () => {
      try {
        const now = Date.now() / 1000;

        // 定期トークンリフレッシュ（2時間ごと）
        if (now - lastTokenRefresh > tokenRefreshInterval) {
          logger.info("⏰ 定期トークンリフレッシュを実行...");
          const newToken = await refreshAccessTokenAdvanced(this.config);
          if (newToken) {
            lastTokenRefresh = now;
            logger.info("✅ 定期トークンリフレッシュ完了");
          } else {
            logger.warn(
              "⚠️ 定期トークンリフレッシュ失敗。次回再試行します。"
            );
          }
        }

        // リキャスト通知チェック
        for (const [name, notifier] of Object.entries(this.recastNotifiers)) {
          try {
            await notifier.notifyIfReady(now);
          } catch (e) {
            logger.error(`${name}リキャスト通知処理中にエラー: ${e}`);
          }
        }
      } catch (e) {
        logger.error(`❌ キープアライブ中にエラー: ${e}`);
      }
    }, connectionCheckInterval);
  }

  private _startStreamMonitor(): void {
    if (this.streamMonitorTimer) clearInterval(this.streamMonitorTimer);

    let errorCount = 0;
    const maxErrors = 5;

    const checkStreamStatus = async () => {
      try {
        const stream = await this.apiClient.streams.getStreamByUserName(
          this.config.loginChannel
        );

        if (stream) {
          if (!this.streamLive) {
            logger.info(`🎥 配信が開始されました！タイトル: ${stream.title}`);
            await this._handleStreamStarted(stream);
            this.streamLive = true;
            await this._notifyStreamStartedOnDiscord(stream.title);
          }

          if (this.commentSpeedMeter.streamStartedAt() === null) {
            const startedAt = stream.startDate.getTime() / 1000;
            this.commentSpeedMeter.ensureStreamStarted(startedAt);
            saveCommentState(
              this.config.envFile,
              this.commentSpeedMeter.totalCount(),
              startedAt
            );
          }
        } else {
          const summaryState = this.streamSummaryStateStore.load();
          if (this.streamLive || (summaryState && summaryState.status !== "posted")) {
            logger.info("📢 配信が終了しました！");
            await this._finalizeAndPostStreamSummary(new Date().toISOString());
            this.commentSpeedMeter.resetStream();
            saveCommentState(this.config.envFile, 0, 0);
            this.streamLive = false;
          }
        }

        errorCount = 0;
      } catch (e) {
        errorCount++;
        logger.error(
          `⚠️ 配信状態チェックエラー (${errorCount}/${maxErrors}): ${e}`
        );

        if (errorCount >= maxErrors) {
          logger.warn("🔄 エラーが続くため、トークンを自動更新します...");
          const newToken = await refreshAccessTokenAdvanced(this.config);
          if (newToken) {
            errorCount = 0;
            logger.info("✅ トークン更新完了。監視を継続します。");
          }
        }
      }
    };

    void checkStreamStatus();
    this.streamMonitorTimer = setInterval(checkStreamStatus, 180_000); // 180秒ごと
  }

  private async _handleStreamStarted(stream: {
    id: string;
    title: string;
    gameName?: string;
    startDate: Date;
  }): Promise<void> {
    const existing = this.streamSummaryStateStore.load();
    if (existing && existing.status !== "posted" && existing.streamId !== stream.id) {
      await this._finalizeAndPostStreamSummary(new Date().toISOString());
    }

    const startedAt = stream.startDate.getTime() / 1000;
    const sameStream =
      existing && existing.status !== "posted" && existing.streamId === stream.id;

    if (!sameStream) {
      this.commentSpeedMeter.startStream(startedAt);
      saveCommentState(this.config.envFile, 0, startedAt);
      this.streamSummaryStateStore.save({
        status: "active",
        streamId: stream.id,
        title: stream.title,
        gameName: stream.gameName ?? null,
        startedAt: stream.startDate.toISOString(),
        streamUrl: `https://www.twitch.tv/${this.config.loginChannel}`,
        commentCount: 0,
        raidCount: 0,
        postedClipIds: [],
      });
      return;
    }

    this.commentSpeedMeter.ensureStreamStarted(startedAt);
    this.streamSummaryStateStore.updateCounts(
      this.commentSpeedMeter.totalCount(),
      existing.raidCount
    );
  }

  private async _notifyStreamStartedOnDiscord(title: string): Promise<void> {
    await this.streamNotifier.notifyIfNeeded(title, async (message) => {
      if (!this.config.discordWebhookUrl) return;

      const started = await startStreamSummaryThread({
        webhookUrl: this.config.discordWebhookUrl,
        botToken: this.config.discordBotToken || undefined,
        channelId: this.config.discordSummaryChannelId || undefined,
        webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
          ? `配信まとめ - ${title}`.slice(0, 100)
          : undefined,
        title,
        message,
      });

      const state = this.streamSummaryStateStore.load();
      if (!state || state.status === "posted") return;

      this.streamSummaryStateStore.save({
        ...state,
        startMessageId: started.startMessageId ?? state.startMessageId,
        threadId: started.threadId ?? state.threadId,
      });
    });
  }

  private async _finalizeAndPostStreamSummary(endedAt: string): Promise<void> {
    const current = this.streamSummaryStateStore.load();
    if (!current || current.status === "posted") return;
    if (!this.config.discordWebhookUrl) {
      logger.warn("⚠️ DISCORD_WEBHOOK_URL 未設定のため配信まとめ投稿を保留します。");
      return;
    }

    const pending =
      current.status === "pending"
        ? current
        : this.streamSummaryStateStore.markPending(endedAt);
    if (!pending) return;

    try {
      await this.clipCacheSynchronizer?.syncWindow({
        start: new Date(pending.startedAt),
        end: new Date(pending.endedAt ?? endedAt),
      });
      const clips = this.clipCacheStore.listClipsCreatedBetween(
        pending.startedAt,
        pending.endedAt ?? endedAt,
        this.config.maxSummaryClipPosts
      );
      const posted = await postStreamSummary({
        webhookUrl: this.config.discordWebhookUrl,
        botToken: this.config.discordBotToken || undefined,
        channelId: this.config.discordSummaryChannelId || undefined,
        webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
          ? `配信まとめ - ${pending.title}`.slice(0, 100)
          : undefined,
        state: pending,
        clips,
        persistProgress: (state) => this.streamSummaryStateStore.save(state),
      });
      this.streamSummaryStateStore.save(posted);
      logger.info(
        `✅ 配信まとめを投稿しました: streamId=${posted.streamId}, clips=${clips.length}`
      );
    } catch (e) {
      logger.error(`❌ 配信まとめ投稿に失敗しました。次回起動/監視で再試行します: ${e}`);
    }
  }
}
