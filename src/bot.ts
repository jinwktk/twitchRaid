import { ChatClient, ChatMessage } from "@twurple/chat";
import { ApiClient } from "@twurple/api";
import { RefreshingAuthProvider } from "@twurple/auth";
import type { Config } from "./config";
import logger from "./utils/logger";
import { StreamTitleNotifier } from "./notifications/stream-notifications";
import type { DiscordWebhookPayload } from "./notifications/discord-webhook";
import { ClipRecastNotifier } from "./notifications/clip-recast-notifier";
import { PeriodicRecommendationNotifier } from "./notifications/periodic-recommendation-notifier";
import { CommentSpeedMeter } from "./chat/comment-speed-meter";
import { CommandCooldownState } from "./chat/command-cooldown-state";
import { isCommandMessage } from "./chat/message-filters";
import { formatTotalCommentCount } from "./chat/comment-count-formatter";
import { appendContextualChatReplyEmote } from "./chat/reply-emotes";
import {
  loadCommentState,
  saveCommentState,
} from "./utils/comment-state-store";
import {
  StreamSummaryStateStore,
  type StreamSummaryState,
} from "./streams/stream-summary-state-store";
import { StreamSummaryCountBuffer } from "./streams/stream-summary-count-buffer";
import {
  ensureStreamSummaryStartThread,
  mergeStreamStartThreadResult,
  postStreamSummaryClips,
  postStreamSummary,
  startStreamSummaryThread,
  type StartStreamSummaryThreadResult,
} from "./streams/stream-summary";
import { refreshAccessTokenAdvanced } from "./auth/token-manager";
import {
  clipHistoryKey,
  clipSearchHistoryKey,
  normalizeClipSearchQuery,
  resolveClipCreatorId,
  selectCachedClip,
  selectCachedClipSearch,
  selectClip,
  type ClipCommandName,
} from "./commands/clip";
import { ClipCacheStore } from "./commands/clip-cache-store";
import { ClipCacheSynchronizer } from "./commands/clip-cache-sync";
import { ClipSearchDataPublisher } from "./docs/clip-search-data-publisher";
import {
  ShoutoutQueue,
  isShoutoutRateLimitError,
  isShoutoutAdmin,
  normalizeShoutoutTarget,
  sendShoutout,
} from "./commands/shoutout";
import {
  fetchRaidSourceInfo,
  type RaidSourceInfo,
} from "./commands/raid-info";
import {
  buildRaidGreetingMessage,
} from "./commands/shoutout-introduction";
import {
  extractMentionChatPrompt,
  formatMentionChatLogValue,
  generateMentionChatReply,
  isMentionChatStreamImageQuestion,
} from "./commands/mention-chat";
import {
  loadMentionChatMemory,
  saveMentionChatAutoLearnMemory,
} from "./commands/mention-chat-memory";
import {
  fetchMentionChatSearchContext,
  shouldSearchMentionChat,
} from "./commands/mention-chat-search";
import {
  isStreamNotifyAdmin,
  sendManualStreamNotification,
  type ManualStreamNotificationStream,
} from "./commands/stream-notify";
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
  StreamedGameCandidateCache,
  buildStreamedGameCandidates,
  formatGameSuggestion,
  selectRandomStreamedGame,
} from "./commands/game";
import {
  BOOM_COMMAND_USAGE,
  BoomSummaryCache,
  buildBoomSummary,
  formatBoomSummary,
  parseBoomCommandLookbackDays,
} from "./commands/boom";
import { restartProcess } from "./utils/process-restart";


const MANGA_DELETE_DELAY_SECONDS = 10;
const DEFAULT_MENTION_CHAT_COOLDOWN_SECONDS = 5;
const MENTION_CHAT_SKIP_PROMPT_LIMIT = 80;
const MENTION_CHAT_STREAM_IMAGE_WIDTH = 640;
const MENTION_CHAT_STREAM_IMAGE_HEIGHT = 360;
const MENTION_CHAT_STREAM_IMAGE_TIMEOUT_MS = 5_000;
const CHAT_AI_COMMAND_USAGE = "⚠️ 使い方: !chat <メッセージ>";
const YOUTUBE_CHANNEL_URL = "https://is.gd/rukalunyt";
const HELP_MESSAGE =
  "!使えるコマンド: 基本 !help / !age / !goods / !site / !x / !youtube / !game / !weight / !height / !mood / !menu | AI !chat <メッセージ> | Clip !clip / !myclip / !clipsearch <キーワード> | 統計 !speed / !commentcount / !boom [日数] | 漫画 !manga / !mangaon / !mangaoff | 管理 !shoutout <ユーザー名> / !streamnotify";
const MENTION_CHAT_MEMORY_REQUEST_LOG_VALUE = "[memory-request]";

function formatSkippedMentionPrompt(prompt: string): string {
  const singleLine = prompt.replace(/\s+/g, " ").trim() || "内容なし";
  if (singleLine.length <= MENTION_CHAT_SKIP_PROMPT_LIMIT) return singleLine;
  return `${singleLine.slice(0, MENTION_CHAT_SKIP_PROMPT_LIMIT - 3).trimEnd()}...`;
}

function formatMentionChatCooldownReply(
  prompt: string,
  remainingSeconds: number
): string {
  return `AI返信はクールダウン中です（残り${remainingSeconds}秒）: ${formatSkippedMentionPrompt(prompt)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMentionChatMemoryRequest(prompt: string): boolean {
  return /(?:覚えて|記憶して|メモして|忘れないで)/u.test(prompt);
}

interface MentionChatRequest {
  channel: string;
  userName: string;
  alias: string;
  prompt: string;
}

interface MentionChatInput {
  channel: string;
  user: string;
  alias: string;
  prompt: string;
  now: number;
}

interface StreamThumbnailSource {
  getThumbnailUrl?: (width: number, height: number) => string;
  thumbnailUrl?: string | null;
}

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
  private readonly recommendationNotifier: PeriodicRecommendationNotifier;
  private readonly recastNotifiers: Record<string, ClipRecastNotifier>;
  private readonly commandCooldownState: CommandCooldownState;
  private readonly commentSpeedMeter: CommentSpeedMeter;
  private readonly clipCacheStore: ClipCacheStore;
  private readonly streamSummaryStateStore: StreamSummaryStateStore;
  private readonly streamSummaryCountBuffer: StreamSummaryCountBuffer<StreamSummaryState>;
  private readonly boomSummaryCache = new BoomSummaryCache();
  private readonly streamedGameCandidateCache = new StreamedGameCandidateCache();
  private readonly shoutoutQueue: ShoutoutQueue;
  private readonly clipSearchDataPublisher: ClipSearchDataPublisher | null;
  private clipCacheSynchronizer: ClipCacheSynchronizer | null = null;
  private mentionChatInFlight = false;
  private mentionChatQueueDraining = false;
  private readonly mentionChatQueue: MentionChatRequest[] = [];
  private lastMentionChatAttemptAt = 0;
  private streamClipPostRunning = false;
  private streamClipPostRerunRequested = false;
  private streamClipPostRerunAt: Date | null = null;

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
    this.recommendationNotifier = new PeriodicRecommendationNotifier({
      enabled: config.chatRecommendationEnabled ?? true,
      intervalSeconds: (config.chatRecommendationIntervalMinutes ?? 60) * 60,
      initialStreamStartedAt: Date.now() / 1000,
    });
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
    this.clipSearchDataPublisher = config.clipSearchAutoPublishEnabled
      ? new ClipSearchDataPublisher({
          enabled: true,
          dbPath: config.clipCacheDbPath,
          outPath: config.clipSearchDataPath,
          publishRepoDir: config.clipSearchPublishRepoDir,
          minIntervalMs: config.clipSearchPublishMinIntervalMs,
          remote: config.clipSearchPublishRemote,
          branch: config.clipSearchPublishBranch,
          githubToken: config.clipSearchPublishGithubToken,
          githubUsername: config.clipSearchPublishGithubUsername,
        })
      : null;
    this.streamSummaryStateStore = new StreamSummaryStateStore(
      config.streamSummaryStatePath
    );
    this.streamSummaryCountBuffer = new StreamSummaryCountBuffer({
      debounceMs: this.commentSaveDebounceMs,
      loadState: () => this.streamSummaryStateStore.load(),
      updateCounts: (commentCount, raidCount) =>
        this.streamSummaryStateStore.updateCounts(commentCount, raidCount),
    });
    this.shoutoutQueue = new ShoutoutQueue({
      send: (username) =>
        this._sendShoutout(username, { throwRateLimitError: true }),
      onEvent: (event) => {
        if (event.type === "sent") {
          logger.info(`✅ Queued shoutout sent to ${event.targetUsername}`);
        } else if (event.type === "not-found") {
          logger.warn(`⚠️ Queued shoutout target not found: ${event.targetUsername}`);
        } else if (event.type === "rate-limited") {
          logger.warn(
            `⚠️ Shoutout rate limited. Requeued after cooldown: ${event.targetUsername}`
          );
        } else {
          logger.error(
            `❌ Queued shoutout failed for ${event.targetUsername}: ${event.error}`
          );
        }
      },
    });

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
      recentWindowMinutes: this.config.clipRecentWindowMinutes,
      isStreamLive: () => this.streamLive,
      onRecentSyncComplete: async (result) => {
        const tasks: Promise<unknown>[] = [
          this._postNewStreamClipsToSummaryThread(),
        ];
        if (this.clipSearchDataPublisher) {
          tasks.push(this.clipSearchDataPublisher.publishAfterRecentSync(result));
        }
        const outcomes = await Promise.allSettled(tasks);
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            logger.warn(`⚠️ 直近clip同期後処理失敗: ${outcome.reason}`);
          }
        }
      },
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
    this._flushStreamSummaryCounts();
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
        await this._handleRegularMessage(channel, user, text);
      }
    });

    this.chatClient.onJoin((_channel, user) => {
      logger.debug(`ユーザー参加: ${user}`);
    });

    // レイドイベント
    this.chatClient.onRaid(async (channel, user, raidInfo) => {
      logger.info(
        `Raid detected from ${user}. Viewers: ${raidInfo.viewerCount}. Sending shoutout.`
      );
      this._incrementStreamSummaryRaid();
      const sourceInfo = await this._fetchRaidSourceInfo(user);
      this._enqueueRaidShoutout(user);
      await this._sendRaidGreeting(channel, sourceInfo, raidInfo.viewerCount);
    });
  }

  private async _handleRegularMessage(
    channel: string,
    user: string,
    text: string,
    now = Date.now() / 1000
  ): Promise<void> {
    this.commentSpeedMeter.record(now);
    this._debouncedSaveCommentState();
    this._persistStreamSummaryCounts();
    await this._handleMentionChat(channel, user, text, now);
  }

  private async _handleMentionChat(
    channel: string,
    user: string,
    text: string,
    now: number
  ): Promise<void> {
    if (!(this.config.chatAiEnabled ?? false)) return;

    const match = extractMentionChatPrompt(
      text,
      this.config.chatAiBotAliases ?? [this.config.loginChannel]
    );
    if (!match) return;

    await this._enqueueMentionChatRequest({
      channel,
      user,
      alias: match.alias,
      prompt: match.prompt,
      now,
    });
  }

  private async _handleChatAiCommand(
    channel: string,
    user: string,
    prompt: string,
    now: number
  ): Promise<void> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      await this.chatClient.say(channel, CHAT_AI_COMMAND_USAGE);
      return;
    }
    if (!(this.config.chatAiEnabled ?? false)) return;

    await this._enqueueMentionChatRequest({
      channel,
      user,
      alias: "!chat",
      prompt: normalizedPrompt,
      now,
    });
  }

  private async _enqueueMentionChatRequest({
    channel,
    user,
    alias,
    prompt,
    now,
  }: MentionChatInput): Promise<void> {
    const normalizedUser = user.trim().replace(/^[@＠]+/, "").toLowerCase();
    const ignoredUsers = this.config.chatAiIgnoredUsers ?? [
      this.config.loginChannel,
    ];
    if (ignoredUsers.includes(normalizedUser)) {
      logger.info(
        `AIメンション会話をスキップ: ignored_user=${normalizedUser}, alias=${alias}`
      );
      return;
    }

    const request: MentionChatRequest = {
      channel,
      userName: normalizedUser,
      alias,
      prompt,
    };

    const cooldownRemainingSeconds =
      this._getMentionChatCooldownRemainingSeconds(now);
    if (
      this.mentionChatInFlight ||
      this.mentionChatQueueDraining ||
      cooldownRemainingSeconds > 0
    ) {
      const queuePosition = this.mentionChatQueue.push(request);
      let queueReason = `cooldown_remaining=${cooldownRemainingSeconds}s`;
      if (this.mentionChatInFlight) {
        queueReason = "in_flight";
      } else if (this.mentionChatQueueDraining) {
        queueReason = "queue_draining";
      }
      logger.info(
        `AIメンション会話をキュー登録: position=${queuePosition}, reason=${queueReason}, user=${normalizedUser}, alias=${alias}`
      );
      if (!this.mentionChatInFlight && !this.mentionChatQueueDraining) {
        void this._drainMentionChatQueue();
      }
      return;
    }

    await this._processMentionChatRequest(request, now, {
      respectCooldown: true,
    });
    void this._drainMentionChatQueue();
  }

  private async _processMentionChatRequest(
    request: MentionChatRequest,
    now: number,
    options: { respectCooldown: boolean }
  ): Promise<void> {
    const remainingSeconds = this._getMentionChatCooldownRemainingSeconds(now);
    if (options.respectCooldown && remainingSeconds > 0) {
      const cooldownSeconds =
        this.config.chatAiCooldownSeconds ??
        DEFAULT_MENTION_CHAT_COOLDOWN_SECONDS;
      logger.info(
        `AIメンション会話をスキップ: cooldown=${cooldownSeconds}s, user=${request.userName}`
      );
      await this.chatClient.say(
        request.channel,
        formatMentionChatCooldownReply(request.prompt, remainingSeconds)
      );
      return;
    }

    this.lastMentionChatAttemptAt = now;
    this.mentionChatInFlight = true;
    try {
      const shouldUseStreamImage = isMentionChatStreamImageQuestion(request.prompt);
      const streamImageBase64 = shouldUseStreamImage
        ? await this._fetchMentionChatStreamImageBase64()
        : null;
      const learnResult = saveMentionChatAutoLearnMemory({
        enabled: this.config.chatAiAutoLearnEnabled ?? false,
        filePath: this.config.chatAiMemoryPath ?? "",
        promptText: request.prompt,
        maxKeyChars: this.config.chatAiAutoLearnMaxKeyChars ?? 40,
        maxValueChars: this.config.chatAiAutoLearnMaxValueChars ?? 120,
        maxItems: this.config.chatAiAutoLearnMaxItems ?? 50,
      });
      if (learnResult.saved) {
        logger.info("AIメンション会話メモを保存: result=saved");
      } else if (
        (this.config.chatAiAutoLearnEnabled ?? false) &&
        learnResult.reason !== "not_memory_request"
      ) {
        logger.info(
          `AIメンション会話メモ保存をスキップ: reason=${learnResult.reason}`
        );
      }
      const memory = loadMentionChatMemory({
        enabled: this.config.chatAiMemoryEnabled ?? false,
        filePath: this.config.chatAiMemoryPath ?? "",
        maxItems: this.config.chatAiMemoryMaxItems ?? 8,
        maxChars: this.config.chatAiMemoryMaxChars ?? 600,
      });
      if (memory.text) {
        logger.info(
          `AIメンション会話メモを適用: items=${memory.itemCount}, chars=${memory.charCount}`
        );
      }
      const combinedMemoryText = memory.text || null;
      const searchEnabled = this.config.chatAiSearchEnabled ?? false;
      const searchCandidate = shouldSearchMentionChat(request.prompt);
      const searchContext = await fetchMentionChatSearchContext({
        enabled: searchEnabled,
        endpoint:
          this.config.chatAiSearchEndpoint ?? "https://api.duckduckgo.com/",
        queryText: request.prompt,
        timeoutMs: this.config.chatAiSearchTimeoutMs ?? 2_500,
        maxQueryChars: this.config.chatAiSearchMaxQueryChars ?? 120,
        maxResponseBytes: this.config.chatAiSearchMaxResponseBytes ?? 65_536,
        maxResults: this.config.chatAiSearchMaxResults ?? 3,
      });
      if (searchContext) {
        logger.info(
          `AIメンション会話外部検索を適用: results=${searchContext.resultCount}`
        );
      } else if (searchCandidate) {
        logger.info(
          `AIメンション会話外部検索は未適用: reason=${
            searchEnabled ? "no_result_or_failed" : "disabled"
          }`
        );
      }
      const model =
        shouldUseStreamImage && streamImageBase64 && this.config.chatAiVisionModel
          ? this.config.chatAiVisionModel
          : this.config.chatAiModel ?? "";
      const promptLogValue = isMentionChatMemoryRequest(request.prompt)
        ? MENTION_CHAT_MEMORY_REQUEST_LOG_VALUE
        : request.prompt;
      const reply = await generateMentionChatReply({
        enabled: true,
        baseUrl: this.config.chatAiBaseUrl ?? this.config.ollamaBaseUrl,
        model,
        timeoutMs: this.config.chatAiTimeoutMs ?? 8_000,
        timeoutFallbackReply: this.config.chatAiTimeoutFallbackReply,
        keepAlive: this.config.chatAiKeepAlive ?? "30m",
        maxResponseChars: this.config.chatAiMaxResponseChars ?? 200,
        channel: request.channel,
        userName: request.userName,
        promptText: request.prompt,
        redactedPromptText: promptLogValue,
        memoryText: combinedMemoryText,
        searchContextText: searchContext?.text,
        streamImageBase64,
        promptReplyLogEnabled: this.config.chatAiPromptReplyLogEnabled ?? false,
      });

      if (!reply) {
        logger.warn(
          `⚠️ AIメンション会話は返信なし: user=${request.userName}, alias=${request.alias}`
        );
        return;
      }

      const replyWithEmote = appendContextualChatReplyEmote(
        reply,
        this.config.chatReplyEmotes,
        {
          source: "mention",
          promptText: request.prompt,
        }
      );
      logger.info(
        `AIメンション会話応答: user=${request.userName}, alias=${request.alias}, model=${model}, image=${Boolean(streamImageBase64)}, prompt=${formatMentionChatLogValue(promptLogValue)}, reply=${formatMentionChatLogValue(replyWithEmote)}`
      );
      await this.chatClient.say(request.channel, replyWithEmote);
      logger.info(
        `✅ AIメンション会話を送信: user=${request.userName}, alias=${request.alias}`
      );
    } catch (e) {
      logger.error(`❌ AIメンション会話の送信に失敗しました: ${e}`);
    } finally {
      this.mentionChatInFlight = false;
    }
  }

  private _getMentionChatCooldownRemainingSeconds(now: number): number {
    const cooldownSeconds =
      this.config.chatAiCooldownSeconds ?? DEFAULT_MENTION_CHAT_COOLDOWN_SECONDS;
    if (cooldownSeconds <= 0 || this.lastMentionChatAttemptAt <= 0) return 0;

    return Math.max(
      0,
      Math.ceil(cooldownSeconds - (now - this.lastMentionChatAttemptAt))
    );
  }

  private async _fetchMentionChatStreamImageBase64(): Promise<string | null> {
    if (!(this.config.chatAiStreamImageEnabled ?? false)) return null;
    if (!this.apiClient) return null;

    try {
      const stream = await this.apiClient.streams.getStreamByUserName(
        this.config.loginChannel
      );
      if (!stream) return null;

      const thumbnailUrl = this._resolveMentionChatStreamThumbnailUrl(stream);
      if (!thumbnailUrl) return null;

      const response = await fetch(thumbnailUrl, {
        signal: AbortSignal.timeout(
          Math.min(
            this.config.chatAiTimeoutMs ?? MENTION_CHAT_STREAM_IMAGE_TIMEOUT_MS,
            MENTION_CHAT_STREAM_IMAGE_TIMEOUT_MS
          )
        ),
      });
      if (!response.ok) {
        logger.warn(
          `⚠️ AIメンション会話の配信画像取得失敗: status=${response.status}`
        );
        return null;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return null;

      logger.info(
        `AIメンション会話へ配信画像を添付: bytes=${bytes.length}`
      );
      return bytes.toString("base64");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(
        `⚠️ AIメンション会話の配信画像取得失敗: reason=exception, error=${message}`
      );
      return null;
    }
  }

  private _resolveMentionChatStreamThumbnailUrl(
    stream: StreamThumbnailSource
  ): string | null {
    if (typeof stream.getThumbnailUrl === "function") {
      return stream.getThumbnailUrl(
        MENTION_CHAT_STREAM_IMAGE_WIDTH,
        MENTION_CHAT_STREAM_IMAGE_HEIGHT
      );
    }

    const thumbnailUrl = stream.thumbnailUrl?.trim();
    if (!thumbnailUrl) return null;
    return thumbnailUrl
      .replace("{width}", String(MENTION_CHAT_STREAM_IMAGE_WIDTH))
      .replace("{height}", String(MENTION_CHAT_STREAM_IMAGE_HEIGHT));
  }

  private async _drainMentionChatQueue(): Promise<void> {
    if (this.mentionChatQueueDraining) return;
    this.mentionChatQueueDraining = true;

    try {
      while (this.mentionChatQueue.length > 0) {
        const request = this.mentionChatQueue.shift();
        if (!request) continue;

        const cooldownSeconds =
          this.config.chatAiCooldownSeconds ??
          DEFAULT_MENTION_CHAT_COOLDOWN_SECONDS;
        const now = Date.now() / 1000;
        const remainingMs = Math.max(
          0,
          (cooldownSeconds - (now - this.lastMentionChatAttemptAt)) * 1000
        );
        if (remainingMs > 0) await sleep(remainingMs);

        await this._processMentionChatRequest(request, Date.now() / 1000, {
          respectCooldown: false,
        });
      }
    } finally {
      this.mentionChatQueueDraining = false;
      if (this.mentionChatQueue.length > 0) {
        void this._drainMentionChatQueue();
      }
    }
  }

  private async _handleCommand(
    channel: string,
    user: string,
    text: string,
    msg: ChatMessage
  ): Promise<void> {
    const commandText = text.slice(this.config.commandPrefix.length).trim();
    const args = commandText.split(/\s+/);
    const cmd = args[0].toLowerCase();
    const restText = commandText.slice(args[0].length).trim();

    switch (cmd) {
      case "help":
        await this.chatClient.say(channel, HELP_MESSAGE);
        break;
      case "age":
        await this.chatClient.say(channel, String(calculateAge()));
        break;
      case "goods":
        await this.chatClient.say(channel, "https://rukalun.booth.pm");
        break;
      case "site":
        await this.chatClient.say(channel, "https://www.rukalun.mydns.jp");
        break;
      case "x":
        await this.chatClient.say(channel, "https://x.com/rukalunlol");
        break;
      case "youtube":
        await this.chatClient.say(channel, YOUTUBE_CHANNEL_URL);
        break;
      case "game":
        await this._handleGameCommand(channel);
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
      case "chat":
        await this._handleChatAiCommand(
          channel,
          user,
          restText,
          Date.now() / 1000
        );
        break;
      case "speed":
        await this._handleSpeedCommand(channel);
        break;
      case "commentcount":
        await this._handleCommentCountCommand(channel);
        break;
      case "boom":
        await this._handleBoomCommand(channel, restText);
        break;
      case "clip":
        await this._handleClipCommand(channel, user, "clip");
        break;
      case "myclip":
        await this._handleClipCommand(channel, user, "myclip", user);
        break;
      case "clipsearch":
        await this._handleClipSearchCommand(channel, restText);
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
      case "streamnotify":
        await this._handleStreamNotifyCommand(channel, user, msg);
        break;
      default:
        break;
    }
  }

  private async _handleClipSearchCommand(
    channel: string,
    query: string
  ): Promise<void> {
    const normalizedQuery = normalizeClipSearchQuery(query);
    if (!normalizedQuery) {
      await this.chatClient.say(channel, "⚠️ 使い方: !clipsearch <キーワード>");
      return;
    }

    this.clipCacheSynchronizer?.syncRecentIfStale();
    const clip = selectCachedClipSearch(this.clipCacheStore, normalizedQuery);

    if (clip) {
      await this.chatClient.say(channel, clip.url);
      this.clipCacheStore.recordHistory(
        clipSearchHistoryKey(normalizedQuery),
        clip.id
      );
      return;
    }

    await this.chatClient.say(
      channel,
      `⚠️ \`${normalizedQuery}\` に一致するクリップが見つかりませんでした。`
    );
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

  private async _handleBoomCommand(
    channel: string,
    restText: string
  ): Promise<void> {
    const lookbackDays = parseBoomCommandLookbackDays(restText);
    if (lookbackDays === null) {
      await this.chatClient.say(channel, BOOM_COMMAND_USAGE);
      return;
    }

    try {
      const summary = await this.boomSummaryCache.getOrLoad(lookbackDays, () =>
        buildBoomSummary(this.apiClient, {
          broadcasterId: this.config.twitchBroadcasterId,
          gqlClientId: this.config.twitchGqlClientId,
          lookbackDays,
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

  private async _handleGameCommand(channel: string): Promise<void> {
    try {
      const candidates = await this.streamedGameCandidateCache.getOrLoad(() =>
        buildStreamedGameCandidates(this.apiClient, {
          broadcasterId: this.config.twitchBroadcasterId,
          gqlClientId: this.config.twitchGqlClientId,
        })
      );
      const game = selectRandomStreamedGame(candidates);

      if (!game) {
        await this.chatClient.say(
          channel,
          "⚠️ 配信したことのあるゲーム候補が見つかりませんでした。"
        );
        return;
      }

      await this.chatClient.say(channel, formatGameSuggestion(game));
    } catch (e) {
      logger.error(`❌ game候補取得失敗: ${e}`);
      await this.chatClient.say(
        channel,
        "⚠️ 配信したことのあるゲーム候補の取得に失敗しました。時間をおいて再試行してください。"
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

  private async _handleStreamNotifyCommand(
    channel: string,
    user: string,
    msg: ChatMessage
  ): Promise<void> {
    if (
      !isStreamNotifyAdmin(
        user,
        this.config.shoutoutAdminUsers,
        msg.userInfo.isMod,
        msg.userInfo.isBroadcaster
      )
    ) {
      await this.chatClient.say(
        channel,
        "⚠️ `streamnotify` は管理者のみ実行できます。"
      );
      return;
    }

    const result = await sendManualStreamNotification({
      apiClient: this.apiClient,
      loginChannel: this.config.loginChannel,
      postNotification: async (stream) => {
        await this._postManualStreamStartNotification(stream);
      },
    });

    if (result.status === "offline") {
      await this.chatClient.say(
        channel,
        "⚠️ 現在配信中ではないため、配信通知は送信しませんでした。"
      );
      return;
    }

    if (result.status === "failed") {
      logger.error(`❌ 手動配信通知に失敗しました: ${result.error}`);
      await this.chatClient.say(
        channel,
        "⚠️ 配信通知の手動送信に失敗しました。ログを確認してください。"
      );
      return;
    }

    await this.chatClient.say(
      channel,
      `✅ 配信通知をDiscordへ送信しました: ${result.title}`
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

  private _enqueueRaidShoutout(username: string): void {
    const result = this.shoutoutQueue.enqueue(username);
    if (!result) {
      logger.warn(`⚠️ Raid元ユーザー名が空のためshoutoutキュー投入をスキップ: ${username}`);
      return;
    }

    logger.info(
      `📣 Raid shoutout queued: target=${result.targetUsername}, queueSize=${result.queueSize}`
    );
  }

  private async _sendShoutout(
    username: string,
    options: { throwRateLimitError?: boolean } = {}
  ): Promise<boolean> {
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
      if (isShoutoutRateLimitError(e)) {
        logger.warn(`⚠️ Shoutout cooldown hit for ${username}`);
        if (options.throwRateLimitError) throw e;
        return false;
      }
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
        if (
          options.throwRateLimitError &&
          isShoutoutRateLimitError(retryErr)
        ) {
          throw retryErr;
        }
      }
      return false;
    }
  }

  private async _fetchRaidSourceInfo(
    username: string
  ): Promise<RaidSourceInfo> {
    const fallbackUserName = username.trim().replace(/^[@＠]+/, "").toLowerCase();
    let info: RaidSourceInfo = {
      userName: fallbackUserName,
      streamUrl: `https://www.twitch.tv/${fallbackUserName}`,
      title: null,
      gameName: null,
    };

    try {
      info = await fetchRaidSourceInfo(this.apiClient, username);
    } catch (e) {
      logger.error(`❌ Raid元配信情報の取得に失敗しました: ${e}`);
    }

    return info;
  }

  private async _sendRaidGreeting(
    channel: string,
    info: RaidSourceInfo,
    viewerCount: number
  ): Promise<void> {
    if (this.config.ollamaShoutoutEnabled && !this.config.ollamaShoutoutModel) {
      logger.warn(
        "⚠️ Ollama Raid挨拶文は有効ですが OLLAMA_SHOUTOUT_MODEL が未設定です。固定文で送信します。"
      );
    }

    try {
      const message = await buildRaidGreetingMessage({
        info,
        viewerCount,
        enabled:
          this.config.ollamaShoutoutEnabled &&
          Boolean(this.config.ollamaShoutoutModel),
        baseUrl: this.config.ollamaBaseUrl,
        model: this.config.ollamaShoutoutModel,
        timeoutMs: this.config.ollamaShoutoutTimeoutMs,
        keepAlive: this.config.ollamaShoutoutKeepAlive,
        onDecision: (decision) => {
          if (decision.status === "generated") {
            logger.info(
              `✅ Ollama Raid挨拶文を採用: target=${decision.userName}, elapsedMs=${decision.elapsedMs ?? "unknown"}, detail=${decision.detail ?? "ok"}`
            );
            return;
          }

          logger.warn(
            `⚠️ Ollama Raid挨拶文を固定文へフォールバック: target=${decision.userName}, reason=${decision.reason ?? "unknown"}, elapsedMs=${decision.elapsedMs ?? "unknown"}, detail=${decision.detail ?? "none"}`
          );
        },
      });
      const messageWithEmote = appendContextualChatReplyEmote(
        message,
        this.config.chatReplyEmotes,
        {
          source: "raid",
          promptText: [info.gameName, info.title].filter(Boolean).join(" "),
        }
      );
      await this.chatClient.say(channel, messageWithEmote);
      logger.info(
        `✅ Raid挨拶文を送信: target=${info.userName}, viewerCount=${viewerCount}, message=${formatMentionChatLogValue(messageWithEmote)}`
      );
    } catch (sendErr) {
      logger.error(`❌ Raid挨拶文の送信に失敗しました: ${sendErr}`);
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
    this.streamSummaryCountBuffer.recordCommentCount(
      this.commentSpeedMeter.totalCount()
    );
  }

  private _incrementStreamSummaryRaid(): void {
    this.streamSummaryCountBuffer.incrementRaidCount(
      this.commentSpeedMeter.totalCount()
    );
  }

  private _flushStreamSummaryCounts(): void {
    this.streamSummaryCountBuffer.flush();
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

        if (this.streamLive) {
          try {
            await this.recommendationNotifier.notifyIfReady(now, (message) =>
              this.chatClient.say(this._chatChannel(), message)
            );
          } catch (e) {
            logger.error(`定期おすすめコメント送信中にエラー: ${e}`);
          }
        }
      } catch (e) {
        logger.error(`❌ キープアライブ中にエラー: ${e}`);
      }
    }, connectionCheckInterval);
  }

  private _chatChannel(): string {
    return this.config.loginChannel.startsWith("#")
      ? this.config.loginChannel
      : `#${this.config.loginChannel}`;
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
            await this._notifyStreamStartedOnDiscord(stream);
            await this._postNewStreamClipsToSummaryThread();
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
            this._flushStreamSummaryCounts();
            await this._finalizeAndPostStreamSummary(new Date().toISOString());
            this.commentSpeedMeter.resetStream();
            saveCommentState(this.config.envFile, 0, 0);
            this.streamLive = false;
          }
          await this.clipCacheSynchronizer?.runDailyReconcileIfDue();
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
      this.recommendationNotifier.reset(startedAt);
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

    if (!this.streamLive) {
      this.recommendationNotifier.reset(startedAt, Date.now() / 1000);
    }
    this.commentSpeedMeter.ensureStreamStarted(startedAt);
    this.streamSummaryStateStore.updateCounts(
      this.commentSpeedMeter.totalCount(),
      existing.raidCount
    );
  }

  private async _postManualStreamStartNotification(
    stream: ManualStreamNotificationStream
  ): Promise<void> {
    await this._handleStreamStarted(stream);
    this.streamLive = true;

    const message = this.streamNotifier.buildPayload(this._streamNotificationDetails(stream));
    const started = await this._forceStreamStartSummaryThread(stream.title, message);
    this._logStreamStartNotificationPreview(stream.title, message, started);
    this.config.updateLastStreamTitle(stream.title.trim());
  }

  private async _notifyStreamStartedOnDiscord(stream: {
    id?: string;
    title: string;
    userDisplayName?: string;
    gameName?: string;
    viewers?: number;
    thumbnailUrl?: string;
    getThumbnailUrl?: (width: number, height: number) => string;
    startDate?: Date;
  }): Promise<void> {
    await this.streamNotifier.notifyIfNeeded(
      this._streamNotificationDetails(stream),
      async (message) => {
        const started = await this._ensureStreamStartSummaryThread(
          stream.title,
          message
        );
        this._logStreamStartNotificationPreview(stream.title, message, started);
      }
    );

    const state = this.streamSummaryStateStore.load();
    if (state && state.status !== "posted" && !state.threadId) {
      const message = this.streamNotifier.buildPayload(
        this._streamNotificationDetails(stream)
      );
      await this._ensureStreamStartSummaryThread(
        stream.title,
        message,
        { allowStartNotificationRepost: false }
      );
    }
  }

  private async _ensureStreamStartSummaryThread(
    title: string,
    message: DiscordWebhookPayload,
    options: { allowStartNotificationRepost?: boolean } = {}
  ): Promise<StartStreamSummaryThreadResult> {
    if (!this._canPostDiscordSummary()) return {};

    const state = this.streamSummaryStateStore.load();
    if (!state || state.status === "posted") return {};

    const started = await ensureStreamSummaryStartThread({
      webhookUrl: this.config.discordWebhookUrl || undefined,
      botToken: this.config.discordBotToken || undefined,
      channelId: this.config.discordSummaryChannelId || undefined,
      webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
        ? `配信まとめ - ${title}`.slice(0, 100)
        : undefined,
      title,
      message,
      state,
      allowStartNotificationRepost: options.allowStartNotificationRepost,
    });

    if (!started.startMessageId && !started.threadId) return started;

    this.streamSummaryStateStore.save(
      mergeStreamStartThreadResult(state, started)
    );
    return started;
  }

  private async _forceStreamStartSummaryThread(
    title: string,
    message: DiscordWebhookPayload
  ): Promise<StartStreamSummaryThreadResult> {
    if (!this._canPostDiscordSummary()) {
      throw new Error("Discord posting is not configured");
    }

    const state = this.streamSummaryStateStore.load();
    if (!state || state.status === "posted") {
      throw new Error("Active stream summary state is not available");
    }

    const started = await startStreamSummaryThread({
      webhookUrl: this.config.discordWebhookUrl || undefined,
      botToken: this.config.discordBotToken || undefined,
      channelId: this.config.discordSummaryChannelId || undefined,
      webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
        ? `配信まとめ - ${title}`.slice(0, 100)
        : undefined,
      title,
      message,
    });

    if (!started.startMessageId && !started.threadId) {
      throw new Error("Discord start notification did not return message or thread id");
    }

    this.streamSummaryStateStore.save(
      mergeStreamStartThreadResult(state, started, { preferStartedThread: true })
    );
    return started;
  }

  private _logStreamStartNotificationPreview(
    title: string,
    message: DiscordWebhookPayload,
    started: StartStreamSummaryThreadResult
  ): void {
    if (!started.postedStartNotification) return;

    const streamPreviewImage = message.embeds?.[0]?.image?.url;
    if (!streamPreviewImage) return;

    logger.info(
      `✅ 配信開始通知Discord投稿を確認しました: title=${title.trim()}, streamPreviewImage=${streamPreviewImage}, startMessageId=${started.startMessageId ?? "none"}, threadId=${started.threadId ?? "none"}`
    );
  }

  private async _ensureCurrentStreamSummaryThread(
    state: StreamSummaryState
  ): Promise<StreamSummaryState | null> {
    if (state.threadId) return state;

    await this._ensureStreamStartSummaryThread(
      state.title,
      this.streamNotifier.buildPayload({
        title: state.title,
        gameName: state.gameName,
        streamUrl: state.streamUrl,
      }),
      { allowStartNotificationRepost: false }
    );

    const current = this.streamSummaryStateStore.load();
    if (!current || current.status === "posted" || !current.threadId) {
      logger.warn(
        `⚠️ 配信まとめスレッドを保証できませんでした: streamId=${state.streamId}, startMessageId=${state.startMessageId ?? "none"}`
      );
      return null;
    }
    return current;
  }

  private async _postNewStreamClipsToSummaryThread(now = new Date()): Promise<void> {
    if (this.streamClipPostRunning) {
      this.streamClipPostRerunRequested = true;
      this.streamClipPostRerunAt = now;
      logger.info("配信まとめスレッドへのクリップ投稿を再実行予約しました。");
      return;
    }

    this.streamClipPostRunning = true;
    let nextNow = now;

    try {
      do {
        this.streamClipPostRerunRequested = false;
        this.streamClipPostRerunAt = null;
        await this._postNewStreamClipsToSummaryThreadOnce(nextNow);

        if (this.streamClipPostRerunRequested) {
          nextNow = this.streamClipPostRerunAt ?? new Date();
        }
      } while (this.streamClipPostRerunRequested);
    } finally {
      this.streamClipPostRunning = false;
      this.streamClipPostRerunRequested = false;
      this.streamClipPostRerunAt = null;
    }
  }

  private async _postNewStreamClipsToSummaryThreadOnce(now: Date): Promise<void> {
    if (!this._canPostDiscordSummary()) return;

    const state = this.streamSummaryStateStore.load();
    if (!state || state.status !== "active") return;

    const current = await this._ensureCurrentStreamSummaryThread(state);
    if (!current || current.status !== "active") return;

    const clips = this.clipCacheStore.listClipsCreatedBetween(
      current.startedAt,
      now.toISOString(),
      1000
    );
    const unpostedCount = clips.filter(
      (clip) => !(current.postedClipIds ?? []).includes(clip.id)
    ).length;
    if (unpostedCount === 0) return;

    try {
      const posted = await postStreamSummaryClips({
        webhookUrl: this.config.discordWebhookUrl || undefined,
        botToken: this.config.discordBotToken || undefined,
        channelId: this.config.discordSummaryChannelId || undefined,
        state: current,
        clips,
        persistProgress: (nextState) => this.streamSummaryStateStore.save(nextState),
      });
      this.streamSummaryStateStore.save(posted);
      logger.info(
        `✅ 配信まとめスレッドへ新規クリップを投稿しました: streamId=${posted.streamId}, clips=${unpostedCount}`
      );
    } catch (e) {
      logger.warn(`⚠️ 配信まとめスレッドへのクリップ投稿に失敗: ${e}`);
    }
  }

  private _streamNotificationDetails(stream: {
    id?: string | null;
    title: string;
    userDisplayName?: string | null;
    gameName?: string | null;
    viewers?: number | null;
    thumbnailUrl?: string | null;
    getThumbnailUrl?: (width: number, height: number) => string;
    startDate?: Date | string | null;
  }): {
    id?: string | null;
    title: string;
    gameName?: string | null;
    viewers?: number | null;
    streamUrl: string;
    thumbnailUrl?: string | null;
    getThumbnailUrl?: (width: number, height: number) => string;
    startDate?: Date | string | null;
    displayName?: string | null;
  } {
    return {
      id: stream.id,
      title: stream.title,
      gameName: stream.gameName,
      viewers: stream.viewers,
      streamUrl: `https://www.twitch.tv/${this.config.loginChannel}`,
      thumbnailUrl: stream.thumbnailUrl,
      getThumbnailUrl: stream.getThumbnailUrl?.bind(stream),
      startDate: stream.startDate,
      displayName: stream.userDisplayName,
    };
  }

  private async _finalizeAndPostStreamSummary(endedAt: string): Promise<void> {
    this._flushStreamSummaryCounts();
    const current = this.streamSummaryStateStore.load();
    if (!current || current.status === "posted") return;
    if (!this._canPostDiscordSummary()) {
      logger.warn(
        "⚠️ Discord投稿設定未完了のため配信まとめ投稿を保留します。"
      );
      return;
    }

    try {
      const finalEndedAt = current.endedAt ?? endedAt;
      await this.clipCacheSynchronizer?.syncWindow({
        start: new Date(current.startedAt),
        end: new Date(finalEndedAt),
      });
      if (current.status === "active") {
        await this._postNewStreamClipsToSummaryThread(new Date(finalEndedAt));
      }

      const pending =
        current.status === "pending"
          ? current
          : this.streamSummaryStateStore.markPending(finalEndedAt);
      if (!pending) return;

      const ensuredPending =
        (await this._ensureCurrentStreamSummaryThread(pending)) ?? pending;

      const clips = this.clipCacheStore.listClipsCreatedBetween(
        ensuredPending.startedAt,
        ensuredPending.endedAt ?? finalEndedAt,
        this.config.maxSummaryClipPosts
      );
      const requireExistingThread = Boolean(
        this.config.discordBotToken && this.config.discordSummaryChannelId
      );
      const posted = await postStreamSummary({
        webhookUrl: this.config.discordWebhookUrl || undefined,
        botToken: this.config.discordBotToken || undefined,
        channelId: this.config.discordSummaryChannelId || undefined,
        webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
          ? `配信まとめ - ${pending.title}`.slice(0, 100)
          : undefined,
        requireExistingThread,
        state: ensuredPending,
        clips,
        persistProgress: (state) => this.streamSummaryStateStore.save(state),
      });
      this.streamSummaryStateStore.save(posted);
      if (posted.status !== "posted") {
        logger.warn(
          `⚠️ 配信まとめスレッド未作成のため終了まとめ投稿を保留しました: streamId=${posted.streamId}, startMessageId=${posted.startMessageId ?? "none"}`
        );
        return;
      }
      logger.info(
        `✅ 配信まとめを投稿しました: streamId=${posted.streamId}, clips=${clips.length}`
      );
    } catch (e) {
      logger.error(`❌ 配信まとめ投稿に失敗しました。次回起動/監視で再試行します: ${e}`);
    }
  }

  private _canPostDiscordSummary(): boolean {
    return Boolean(
      this.config.discordWebhookUrl ||
      (this.config.discordBotToken && this.config.discordSummaryChannelId)
    );
  }
}
