import { ChatClient, ChatMessage } from "@twurple/chat";
import { ApiClient } from "@twurple/api";
import { RefreshingAuthProvider } from "@twurple/auth";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS, type Config } from "./config";
import logger from "./utils/logger";
import { StreamTitleNotifier } from "./notifications/stream-notifications";
import {
  DiscordApiRequestError,
  DiscordHistoryLookupError,
  executeDiscordWebhook,
  sendDiscordBotMessage,
  type DiscordWebhookPayload,
} from "./notifications/discord-webhook";
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
import { createEventSubAuthProvider } from "./streams/eventsub-auth-provider";
import {
  buildStreamSummaryThreadName,
  ensureStreamSummaryStartThread,
  mergeStreamStartThreadResult,
  postStreamSummaryClips,
  postStreamSummary,
  startStreamSummaryThread,
  type EnsureStreamSummaryStartThreadOptions,
  type StartStreamSummaryThreadResult,
} from "./streams/stream-summary";
import {
  getAccessTokenSecondsUntilExpiry,
  refreshAccessTokenAdvanced,
  refreshAccessTokenIfExpiringSoon,
} from "./auth/token-manager";
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
  GENERATED_RAID_GREETING_LIMIT,
  buildRaidGreetingMessage,
  shortenRaidGreetingKeepingUrl,
} from "./commands/shoutout-introduction";
import {
  buildMentionChatPrewarmRequest,
  createMentionChatMatcher,
  formatMentionChatLogValue,
  generateMentionChatReplyDetailed,
  resolveMentionChatImmediateReply,
  type MentionChatMatcher,
} from "./commands/mention-chat";
import {
  primeOllamaGenerateModel,
  prewarmOllamaEmbedModel,
  prewarmOllamaGenerateModel,
} from "./commands/ollama-prewarm";
import {
  analyzeMentionChatMemoryRequest,
  extractImplicitMentionChatMemoryEntry,
  extractStreamCommentMemoryEntries,
  loadMentionChatMemoryAuthorityStore,
  loadMentionChatMemoryStore,
  saveMentionChatAutoLearnMemoryStore,
  saveMentionChatMemoryObservationStore,
  type MentionChatMemoryEntry,
  type AnalyzeMentionChatMemoryRequestResult,
} from "./commands/mention-chat-memory";
import {
  loadMentionChatMem0Memory,
  saveMentionChatMem0Memory,
  shouldRecallMentionChatMem0Memory,
  type MentionChatMem0MemoryItem,
} from "./commands/mention-chat-mem0";
import {
  buildBotRequestNotesDigest,
  extractBotRequestNote,
  markBotRequestNotesDigestSent,
  saveBotRequestNoteObservationStore,
  writeBotRequestNotesDigestFile,
} from "./commands/bot-request-notes";
import {
  fetchMentionChatSearchContext,
  fetchMentionChatSearchContextDetailed,
  shouldResearchMentionChatReply,
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
const STREAM_SUMMARY_THREAD_RETRY_INITIAL_MS = 60_000;
const STREAM_SUMMARY_THREAD_RETRY_MAX_MS = 15 * 60_000;
const STREAM_STATUS_POLL_INTERVAL_MS = 60_000;
const MENTION_CHAT_SKIP_PROMPT_LIMIT = 80;
const CHAT_AI_COMMAND_USAGE = "⚠️ 使い方: !chat <メッセージ>";
const YOUTUBE_CHANNEL_URL = "https://is.gd/rukalunyt";
const SEVEN_DAYS_IMAGE_ALBUM_MESSAGE =
  "7DAYS持ってるチャネポでリスナーさんも色々出来るので遊んでみてね https://imgur.com/a/w9Y9GbN rukkaEeeee";
const DIE_SURVIVAL_REPLY = "簡単に死んでたまるかッ🧟";
const WORK_SEND_OFF_REPLY =
  "るっかるん、今日もお仕事気を付けて、いってらっしゃい";
const HELP_MESSAGE =
  "!使えるコマンド: 基本 !help / !age / !goods / !7days / !die / !work / !site / !x / !youtube / !game / !weight / !height / !mood / !menu | AI !chat <メッセージ> | Clip !clip / !myclip / !clipsearch <キーワード> | 統計 !speed / !commentcount / !boom [日数] | 漫画 !manga / !mangaon / !mangaoff | 管理 !shoutout <ユーザー名> / !streamnotify";
const MENTION_CHAT_MEMORY_REQUEST_LOG_VALUE = "[memory-request]";
const MENTION_CHAT_SEARCH_NO_RESULT_REPLY =
  "ごめん、検索結果がなくて分からないD！";
const MENTION_CHAT_MEMORY_KEYWORD_PATTERN =
  /(?:覚えて(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|覚えといて(?:ください|下さい|ね)?|覚えとけ|記憶して(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|記憶しといて(?:ください|下さい|ね)?|メモして(?!る|ない|なかった|ます|た|い(?:る|た|ない|ます)?)|メモしといて(?:ください|下さい|ね)?|メモっといて(?:ください|下さい|ね)?|忘れないで(?!いる|いた|います|た|しょ))/u;
const MENTION_CHAT_MEMORY_SAVED_REPLY = "覚えたD！";
const MENTION_CHAT_MEMORY_USAGE_REPLY =
  "覚える形式は「覚えて: キー=内容」でお願いD！";
const MENTION_CHAT_MEMORY_UNSAFE_REPLY =
  "その内容は安全のため覚えられないD！";
const MENTION_CHAT_MEMORY_DISABLED_REPLY = "記憶保存は今は無効D！";
const MENTION_CHAT_MEMORY_FORBIDDEN_REPLY =
  "メモ保存は管理者だけできるD！";
const MENTION_CHAT_MEMORY_WRITE_FAILED_REPLY = "メモ保存に失敗したD！";

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
  return MENTION_CHAT_MEMORY_KEYWORD_PATTERN.test(prompt);
}

export function formatCommandDetectionLogText(text: string): string {
  return isMentionChatMemoryRequest(text)
    ? MENTION_CHAT_MEMORY_REQUEST_LOG_VALUE
    : text;
}

function normalizeMentionChatUserName(userName: string): string {
  return userName.trim().replace(/^[@＠]+/, "").toLowerCase();
}

function isMentionChatMemoryWriter(
  userName: string,
  writerUsers: string[]
): boolean {
  const normalizedUserName = normalizeMentionChatUserName(userName);
  const normalizedWriterUsers = writerUsers.map((writer) =>
    normalizeMentionChatUserName(writer)
  );
  return (
    normalizedWriterUsers.includes("all") ||
    normalizedWriterUsers.includes(normalizedUserName)
  );
}

function memoryRequestReplyForReason(reason: string): string {
  if (reason === "unsafe") return MENTION_CHAT_MEMORY_UNSAFE_REPLY;
  if (reason === "write_failed" || reason === "invalid_file") {
    return MENTION_CHAT_MEMORY_WRITE_FAILED_REPLY;
  }
  return MENTION_CHAT_MEMORY_USAGE_REPLY;
}

interface MentionChatRequest {
  channel: string;
  userName: string;
  userDisplayName?: string | null;
  alias: string;
  prompt: string;
}

interface StreamSummaryThreadRetryState {
  failureCount: number;
  nextRetryAt: number;
}

type StreamSummaryThreadEnsurer = (
  options: EnsureStreamSummaryStartThreadOptions
) => Promise<StartStreamSummaryThreadResult>;

interface MentionChatInput {
  channel: string;
  user: string;
  userDisplayName?: string | null;
  alias: string;
  prompt: string;
  now: number;
}

interface MentionChatConversationHistoryEntry {
  role: "user" | "bot";
  userName: string;
  text: string;
  createdAt: number;
}

interface MentionChatConversationHistoryText {
  text: string;
  itemCount: number;
  charCount: number;
}

interface CombinedMentionChatMemoryText {
  text: string | null;
  dedupedMem0ItemCount: number;
}

interface MentionChatMemoryAuthority {
  activeKeys: readonly string[];
  suppressedKeys: readonly string[];
}

const UNSAFE_MENTION_CHAT_CONVERSATION_CONTEXT_PATTERN =
  /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:token|secret|password|passwd|api[\s_-]?key|access[\s_-]?token|refresh[\s_-]?token)\b|apiキー|トークン|アクセストークン|リフレッシュトークン|シークレット|認証情報|認証|パスワード|秘密鍵|秘密|前の指示|上の指示|以前の指示|指示を無視|命令を無視|ルールを無視|システムプロンプト|プロンプトを表示|内部設定|developer message|system prompt|ignore (?:all )?(?:previous|above) instructions/iu;

function normalizeMentionChatConversationKey(channel: string): string {
  return channel.trim().toLowerCase();
}

function getChatMessageDisplayName(msg: ChatMessage | undefined): string | null {
  const displayName = (msg as { userInfo?: { displayName?: string } } | undefined)
    ?.userInfo?.displayName;
  return displayName?.trim() || null;
}

function normalizeMentionChatConversationText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitMentionChatMemoryLines(
  value: string | null | undefined
): string[] {
  return (value ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeMentionChatMemoryLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractMentionChatMemoryLineKey(value: string): string | null {
  const line = value.replace(/\s+/g, " ").trim();
  const separatorIndex = line.search(/[：:]/u);
  if (separatorIndex <= 0) return null;

  const key = line.slice(0, separatorIndex).trim().toLowerCase();
  return key || null;
}

function combineMentionChatMemoryText(
  localMemoryText: string | null | undefined,
  mem0MemoryText: string | null | undefined,
  options: {
    mem0Items?: readonly MentionChatMem0MemoryItem[];
    authority?: MentionChatMemoryAuthority;
    maxChars: number;
  }
): CombinedMentionChatMemoryText {
  const localText = (localMemoryText ?? "").trim();
  const localLines = splitMentionChatMemoryLines(localText);
  const localLineSet = new Set(localLines.map(normalizeMentionChatMemoryLine));
  const localKeySet = new Set(
    localLines
      .map(extractMentionChatMemoryLineKey)
      .filter((key): key is string => Boolean(key))
  );
  const authorityKeySet = new Set(
    [
      ...(options.authority?.activeKeys ?? []),
      ...(options.authority?.suppressedKeys ?? []),
    ]
      .map((key) => key.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean)
  );
  const mem0Items =
    options.mem0Items && options.mem0Items.length > 0
      ? options.mem0Items
      : splitMentionChatMemoryLines(mem0MemoryText).map((text) => ({
          text,
          key: extractMentionChatMemoryLineKey(text),
        }));

  const remainingMem0Lines: string[] = [];
  let dedupedMem0ItemCount = 0;
  for (const item of mem0Items) {
    const line = item.text;
    const normalizedLine = normalizeMentionChatMemoryLine(line);
    const key = (item.key ?? extractMentionChatMemoryLineKey(line))
      ?.replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (
      localLineSet.has(normalizedLine) ||
      (key && (localKeySet.has(key) || authorityKeySet.has(key)))
    ) {
      dedupedMem0ItemCount += 1;
      continue;
    }
    remainingMem0Lines.push(line);
  }

  const maxChars = Math.max(0, Math.floor(options.maxChars));
  const selectedLines: string[] = [];
  const tryAppend = (lines: readonly string[]): boolean => {
    const candidate = [...selectedLines, ...lines].join("\n");
    if (candidate.length > maxChars) return false;
    selectedLines.push(...lines);
    return true;
  };
  for (const line of localLines) {
    if (!tryAppend([line])) break;
  }
  let hasMem0Header = false;
  for (const line of remainingMem0Lines) {
    const lines = hasMem0Header ? [line] : ["mem0メモ:", line];
    if (!tryAppend(lines)) break;
    hasMem0Header = true;
  }

  return {
    text: selectedLines.length > 0 ? selectedLines.join("\n") : null,
    dedupedMem0ItemCount,
  };
}

function shortenMentionChatConversationText(
  value: string,
  maxChars: number
): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function formatMentionChatConversationHistoryEntry(
  entry: MentionChatConversationHistoryEntry
): string {
  const text = normalizeMentionChatConversationText(entry.text);
  return entry.role === "bot"
    ? `るっかるん: ${text}`
    : `ユーザー ${entry.userName}: ${text}`;
}

function buildMentionChatConversationHistoryText({
  entries,
  maxMessages,
  maxChars,
}: {
  entries: MentionChatConversationHistoryEntry[];
  maxMessages: number;
  maxChars: number;
}): MentionChatConversationHistoryText | null {
  const effectiveMaxMessages = Math.max(1, Math.floor(maxMessages));
  const effectiveMaxChars = Math.max(1, Math.floor(maxChars));
  const recentEntries = entries.slice(-effectiveMaxMessages);
  const selectedLines: string[] = [];

  for (let i = recentEntries.length - 1; i >= 0; i -= 1) {
    const line = formatMentionChatConversationHistoryEntry(recentEntries[i]);
    const candidate = [line, ...selectedLines].join("\n");
    if (candidate.length <= effectiveMaxChars) {
      selectedLines.unshift(line);
      continue;
    }

    if (selectedLines.length === 0) {
      selectedLines.unshift(
        shortenMentionChatConversationText(line, effectiveMaxChars)
      );
    }
    break;
  }

  const text = selectedLines.join("\n").trim();
  return text
    ? { text, itemCount: selectedLines.length, charCount: text.length }
    : null;
}

function shouldApplyMentionChatConversationHistory(promptText: string): boolean {
  const prompt = normalizeMentionChatConversationText(promptText);
  if (!prompt) return false;

  if (
    /^(?:どう思う|どうおもう|どうかな|どうですか|どうだと思う)[？?。!！\s]*$/u.test(
      prompt
    ) ||
    /^(?:これ|それ|あれ|この話|その話|今の|さっきの)(?:って|は|を)?どう(?:思う|おもう|かな|ですか)[？?。!！\s]*$/u.test(
      prompt
    )
  ) {
    return true;
  }

  if (/^(?:続き|さらに続き|それで|じゃあ|で、)/u.test(prompt)) {
    return true;
  }
  if (
    /(?:さっき|先ほど|直前|前(?:の|に|言った)|今(?:の|言った)|教えた|言ったじゃん|教えたじゃん|もういい|その話|この話|あの話|同じ話|どんなところ|どこが|どのへん|なんで|どうして|理由|詳しく)/u.test(
      prompt
    )
  ) {
    return true;
  }
  return /^(?:それ|これ|あれ|そこ|ここ)(?:[はがをのってで]|$)/u.test(prompt);
}

function isSafeMentionChatConversationContextText(text: string): boolean {
  const normalized = normalizeMentionChatConversationText(text);
  if (!normalized) return false;
  return !UNSAFE_MENTION_CHAT_CONVERSATION_CONTEXT_PATTERN.test(normalized);
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
  private readonly mentionChatMatcher: MentionChatMatcher;
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
  private readonly mentionChatConversationHistory = new Map<
    string,
    MentionChatConversationHistoryEntry[]
  >();
  private readonly streamCommentMemoryMem0Dedup = new Map<string, number>();
  private mentionChatRequestSequence = 0;
  private lastMentionChatAttemptAt = 0;
  private lastChatAiPrewarmAt = 0;
  private chatAiPrewarmInFlight = false;
  private chatAiStartupOnlyPrewarmAttempted = false;
  private botRequestNotesDigestInFlight = false;
  private readonly streamSummaryThreadEnsureInFlight = new Map<
    string,
    Promise<StartStreamSummaryThreadResult>
  >();
  private readonly streamSummaryThreadRetryState = new Map<
    string,
    StreamSummaryThreadRetryState
  >();
  private readonly streamSummaryManualForceInFlightKeys = new Set<string>();
  private streamSummaryThreadEnsurer: StreamSummaryThreadEnsurer =
    ensureStreamSummaryStartThread;
  private streamEventSubListenerFactory = (apiClient: ApiClient) =>
    new EventSubWsListener({ apiClient });
  private streamEventSubListener: EventSubWsListener | null = null;
  private streamStatusCheckInFlight: Promise<void> | null = null;
  private streamStatusCheckRerunRequested = false;
  private streamStatusErrorCount = 0;
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
    this.mentionChatMatcher = createMentionChatMatcher(
      config.chatAiBotAliases ?? [config.loginChannel]
    );
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
      helixClientId: this.config.twitchClientId,
      helixAccessTokenProvider: () => this.config.twitchAccessToken,
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
    this.streamEventSubListener?.stop();
    this.streamEventSubListener = null;
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
        logger.info(`🤖 コマンド検出: ${formatCommandDetectionLogText(text)}`);
        await this._handleCommand(channel, user, text, msg);
      } else {
        await this._handleRegularMessage(
          channel,
          user,
          text,
          Date.now() / 1000,
          getChatMessageDisplayName(msg)
        );
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
    now = Date.now() / 1000,
    userDisplayName?: string | null
  ): Promise<void> {
    this.commentSpeedMeter.record(now);
    this._debouncedSaveCommentState();
    this._persistStreamSummaryCounts();
    const handledMentionChat = await this._handleMentionChat(
      channel,
      user,
      text,
      now,
      userDisplayName
    );
    if (!handledMentionChat) {
      this._recordStreamCommentConversationHistory(channel, user, text, now);
      this._scheduleStreamCommentMemorySave(user, text);
      this._scheduleBotRequestNoteSave(user, text);
    }
  }

  private async _handleMentionChat(
    channel: string,
    user: string,
    text: string,
    now: number,
    userDisplayName?: string | null
  ): Promise<boolean> {
    const match = this.mentionChatMatcher.extract(text);
    if (!match) return false;
    this._scheduleBotRequestNoteSave(user, match.prompt);
    if (!(this.config.chatAiEnabled ?? false)) return true;

    await this._enqueueMentionChatRequest({
      channel,
      user,
      userDisplayName,
      alias: match.alias,
      prompt: match.prompt,
      now,
    });
    return true;
  }

  private async _handleChatAiCommand(
    channel: string,
    user: string,
    prompt: string,
    now: number,
    userDisplayName?: string | null
  ): Promise<void> {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      await this.chatClient.say(channel, CHAT_AI_COMMAND_USAGE);
      return;
    }
    this._scheduleBotRequestNoteSave(user, normalizedPrompt);
    if (!(this.config.chatAiEnabled ?? false)) return;

    await this._enqueueMentionChatRequest({
      channel,
      user,
      userDisplayName,
      alias: "!chat",
      prompt: normalizedPrompt,
      now,
    });
  }

  private async _enqueueMentionChatRequest({
    channel,
    user,
    userDisplayName,
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
      userDisplayName,
      alias,
      prompt,
    };

    const memoryRequest = this._analyzeMentionChatMemoryRequest(
      request.prompt,
      request.userName
    );
    if (memoryRequest.isMemoryRequest) {
      await this._processMentionChatMemoryRequest(request, memoryRequest);
      return;
    }

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

  private _analyzeMentionChatMemoryRequest(
    prompt: string,
    sourceUser: string
  ): AnalyzeMentionChatMemoryRequestResult {
    return analyzeMentionChatMemoryRequest(prompt, {
      maxKeyChars: this.config.chatAiAutoLearnMaxKeyChars ?? 40,
      maxValueChars: this.config.chatAiAutoLearnMaxValueChars ?? 120,
      sourceUser,
    });
  }

  private _isMentionChatMem0Enabled(): boolean {
    return this.config.chatAiMem0Enabled ?? false;
  }

  private async _saveMentionChatMem0Memory({
    entry,
    kind,
    sourceUser,
    logLabel = "AIメンション会話mem0メモ",
  }: {
    entry: MentionChatMemoryEntry;
    kind: "semantic" | "implicit";
    sourceUser: string;
    logLabel?: string;
  }): Promise<boolean> {
    if (!this._isMentionChatMem0Enabled()) return false;

    const result = await saveMentionChatMem0Memory({
      enabled: true,
      apiKey: this.config.chatAiMem0ApiKey ?? "",
      endpoint: this.config.chatAiMem0Endpoint ?? "",
      userId: this.config.chatAiMem0UserId ?? this.config.loginChannel,
      agentId: this.config.chatAiMem0AgentId ?? "twitchRaid",
      appId: this.config.chatAiMem0AppId ?? "twitchRaid",
      timeoutMs: this.config.chatAiMem0TimeoutMs ?? 1_200,
      entry,
      kind,
      sourceUser,
    });
    if (result.saved) {
      logger.info(`${logLabel}を保存: result=saved`);
    } else {
      logger.info(
        `${logLabel}保存をスキップ: reason=${result.reason}`
      );
    }
    return result.saved;
  }

  private _streamCommentMemoryDedupKey(
    entry: MentionChatMemoryEntry,
    sourceUser: string
  ): string {
    return [
      normalizeMentionChatUserName(sourceUser),
      entry.key.replace(/\s+/g, " ").trim().toLowerCase(),
      entry.value.replace(/\s+/g, " ").trim().toLowerCase(),
    ].join("\n");
  }

  private async _saveStreamCommentMem0Memory(
    entry: MentionChatMemoryEntry,
    sourceUser: string
  ): Promise<void> {
    const ttlSeconds = this.config.chatAiCommentMemoryDedupTtlSeconds ?? 21_600;
    const now = Date.now() / 1000;
    const dedupKey = this._streamCommentMemoryDedupKey(entry, sourceUser);
    const lastSavedAt = this.streamCommentMemoryMem0Dedup.get(dedupKey);
    if (ttlSeconds > 0 && lastSavedAt !== undefined && now - lastSavedAt < ttlSeconds) {
      logger.info("配信コメント由来mem0メモ保存をスキップ: reason=dedup");
      return;
    }

    const saved = await this._saveMentionChatMem0Memory({
      entry,
      kind: "implicit",
      sourceUser,
      logLabel: "配信コメント由来mem0メモ",
    });
    if (saved) {
      this.streamCommentMemoryMem0Dedup.set(dedupKey, now);
    }
  }

  private _scheduleStreamCommentMemorySave(user: string, text: string): void {
    if (!(this.config.chatAiCommentMemoryEnabled ?? false)) return;
    if (!(this.config.chatAiImplicitMemoryEnabled ?? false)) return;
    if (!(this.config.chatAiAutoLearnEnabled ?? false)) return;

    const sourceUser = normalizeMentionChatUserName(user);
    if (!sourceUser) return;
    if ((this.config.chatAiIgnoredUsers ?? []).includes(sourceUser)) return;
    if (
      !isMentionChatMemoryWriter(
        sourceUser,
        this.config.chatAiMemoryWriterUsers ?? []
      )
    ) {
      return;
    }

    setTimeout(() => {
      void (async () => {
        try {
          const entries = extractStreamCommentMemoryEntries(text, {
            maxKeyChars: this.config.chatAiAutoLearnMaxKeyChars ?? 40,
            maxValueChars: this.config.chatAiAutoLearnMaxValueChars ?? 120,
            sourceUser,
            maxEntries: this.config.chatAiCommentMemoryMaxEntriesPerMessage ?? 2,
          });
          if (!entries.length) return;

          for (const entry of entries) {
            const result = saveMentionChatMemoryObservationStore({
              enabled: true,
              store: this.config.chatAiMemoryStore ?? "json",
              jsonPath: this.config.chatAiMemoryPath ?? "",
              sqlitePath: this.config.chatAiMemoryDbPath ?? "",
              entry,
              kind: "implicit",
              maxItems: this.config.chatAiAutoLearnMaxItems ?? 50,
              promotionMinObservations:
                this.config.chatAiMemoryPromotionMinObservations ?? 2,
              sourceUser,
            });
            if (result.reason === "observed") {
              logger.info(
                `配信コメント由来メモを候補として観測: observations=${result.observedCount ?? 1}`
              );
            } else if (result.reason === "promoted") {
              logger.info(
                `配信コメント由来メモを昇格: observations=${result.observedCount ?? 1}`
              );
              await this._saveStreamCommentMem0Memory(entry, sourceUser);
            } else if (result.reason === "already_active") {
              logger.info(
                `配信コメント由来メモは既に有効: observations=${result.observedCount ?? 1}`
              );
            } else {
              logger.info(
                `配信コメント由来メモ保存をスキップ: reason=${result.reason}`
              );
            }
          }
        } catch (e) {
          logger.error(`❌ 配信コメント由来メモ保存に失敗しました: ${e}`);
        }
      })();
    }, 0);
  }

  private _scheduleBotRequestNoteSave(user: string, text: string): void {
    if (!(this.config.botRequestNotesEnabled ?? false)) return;

    const sourceUser = normalizeMentionChatUserName(user);
    if (!sourceUser) return;
    if ((this.config.chatAiIgnoredUsers ?? []).includes(sourceUser)) return;

    setTimeout(() => {
      try {
        const entry = extractBotRequestNote(text, { sourceUser });
        if (!entry) return;

        const result = saveBotRequestNoteObservationStore({
          enabled: true,
          dbPath: this.config.botRequestNotesDbPath ?? "",
          entry,
        });
        if (result.saved) {
          logger.info(
            `Bot要望メモを保存: result=${result.reason}, id=${result.note?.id ?? "unknown"}, observations=${result.note?.observedCount ?? 1}`
          );
        } else {
          logger.info(`Bot要望メモ保存をスキップ: reason=${result.reason}`);
        }
      } catch (e) {
        logger.error(`❌ Bot要望メモ保存に失敗しました: ${e}`);
      }
    }, 0);
  }

  private async _processMentionChatMemoryRequest(
    request: MentionChatRequest,
    memoryRequest: AnalyzeMentionChatMemoryRequestResult
  ): Promise<void> {
    try {
      const autoLearnEnabled = this.config.chatAiAutoLearnEnabled ?? false;
      if (!autoLearnEnabled) {
        logger.info("AIメンション会話メモ保存をスキップ: reason=disabled");
        await this.chatClient.say(
          request.channel,
          MENTION_CHAT_MEMORY_DISABLED_REPLY
        );
        return;
      }

      if (
        !isMentionChatMemoryWriter(
          request.userName,
          this.config.chatAiMemoryWriterUsers ?? []
        )
      ) {
        logger.info(
          `AIメンション会話メモ保存を拒否: reason=forbidden, user=${request.userName}`
        );
        await this.chatClient.say(
          request.channel,
          MENTION_CHAT_MEMORY_FORBIDDEN_REPLY
        );
        return;
      }

      if (memoryRequest.reason !== "valid") {
        logger.info(
          `AIメンション会話メモ保存をスキップ: reason=${memoryRequest.reason}`
        );
        await this.chatClient.say(
          request.channel,
          memoryRequestReplyForReason(memoryRequest.reason)
        );
        return;
      }

      const learnResult = saveMentionChatAutoLearnMemoryStore({
        enabled: autoLearnEnabled,
        store: this.config.chatAiMemoryStore ?? "json",
        jsonPath: this.config.chatAiMemoryPath ?? "",
        sqlitePath: this.config.chatAiMemoryDbPath ?? "",
        promptText: request.prompt,
        maxKeyChars: this.config.chatAiAutoLearnMaxKeyChars ?? 40,
        maxValueChars: this.config.chatAiAutoLearnMaxValueChars ?? 120,
        maxItems: this.config.chatAiAutoLearnMaxItems ?? 50,
        sourceUser: request.userName,
      });
      if (learnResult.saved) {
        logger.info("AIメンション会話メモを保存: result=saved");
        if (memoryRequest.entry) {
          await this._saveMentionChatMem0Memory({
            entry: memoryRequest.entry,
            kind: "semantic",
            sourceUser: request.userName,
          });
        }
        await this.chatClient.say(
          request.channel,
          MENTION_CHAT_MEMORY_SAVED_REPLY
        );
      } else {
        logger.info(
          `AIメンション会話メモ保存をスキップ: reason=${learnResult.reason}`
        );
        await this.chatClient.say(
          request.channel,
          memoryRequestReplyForReason(learnResult.reason)
        );
      }
    } catch (e) {
      logger.error(`❌ AIメンション会話メモ保存応答に失敗しました: ${e}`);
    }
  }

  private _scheduleImplicitMentionChatMemorySave(
    request: MentionChatRequest
  ): void {
    if (!(this.config.chatAiImplicitMemoryEnabled ?? false)) return;
    if (!(this.config.chatAiAutoLearnEnabled ?? false)) return;
    if (
      !isMentionChatMemoryWriter(
        request.userName,
        this.config.chatAiMemoryWriterUsers ?? []
      )
    ) {
      return;
    }

    setTimeout(() => {
      void (async () => {
        try {
          const entry = extractImplicitMentionChatMemoryEntry(request.prompt, {
            maxKeyChars: this.config.chatAiAutoLearnMaxKeyChars ?? 40,
            maxValueChars: this.config.chatAiAutoLearnMaxValueChars ?? 120,
            sourceUser: request.userName,
          });
          if (!entry) return;

          const result = saveMentionChatMemoryObservationStore({
            enabled: true,
            store: this.config.chatAiMemoryStore ?? "json",
            jsonPath: this.config.chatAiMemoryPath ?? "",
            sqlitePath: this.config.chatAiMemoryDbPath ?? "",
            entry,
            kind: "implicit",
            maxItems: this.config.chatAiAutoLearnMaxItems ?? 50,
            promotionMinObservations:
              this.config.chatAiMemoryPromotionMinObservations ?? 2,
            sourceUser: request.userName,
          });
          if (result.reason === "observed") {
            logger.info(
              `AIメンション会話暗黙メモを候補として観測: observations=${result.observedCount ?? 1}`
            );
          } else if (result.reason === "promoted") {
            logger.info(
              `AIメンション会話暗黙メモを昇格: observations=${result.observedCount ?? 1}`
            );
            await this._saveMentionChatMem0Memory({
              entry,
              kind: "implicit",
              sourceUser: request.userName,
            });
          } else if (result.reason === "already_active") {
            logger.info(
              `AIメンション会話暗黙メモは既に有効: observations=${result.observedCount ?? 1}`
            );
          } else if (result.reason !== "not_memory_request") {
            logger.info(
              `AIメンション会話暗黙メモ保存をスキップ: reason=${result.reason}`
            );
          }
        } catch (e) {
          logger.error(`❌ AIメンション会話暗黙メモ保存に失敗しました: ${e}`);
        }
      })();
    }, 0);
  }

  private _getMentionChatConversationHistory(
    channel: string,
    now: number
  ): MentionChatConversationHistoryText | null {
    if (!(this.config.chatAiConversationHistoryEnabled ?? true)) return null;

    const key = normalizeMentionChatConversationKey(channel);
    const entries = this.mentionChatConversationHistory.get(key);
    if (!entries?.length) return null;

    const ttlSeconds = this.config.chatAiConversationHistoryTtlSeconds ?? 1_800;
    const freshEntries = entries.filter(
      (entry) => now - entry.createdAt <= ttlSeconds
    );
    if (freshEntries.length !== entries.length) {
      if (freshEntries.length) {
        this.mentionChatConversationHistory.set(key, freshEntries);
      } else {
        this.mentionChatConversationHistory.delete(key);
      }
    }
    if (!freshEntries.length) return null;

    return buildMentionChatConversationHistoryText({
      entries: freshEntries,
      maxMessages: this.config.chatAiConversationHistoryMaxMessages ?? 6,
      maxChars: this.config.chatAiConversationHistoryMaxChars ?? 1_000,
    });
  }

  private _recordMentionChatConversationHistory(
    request: MentionChatRequest,
    reply: string,
    now: number
  ): void {
    if (!(this.config.chatAiConversationHistoryEnabled ?? true)) return;

    const key = normalizeMentionChatConversationKey(request.channel);
    const entries = this.mentionChatConversationHistory.get(key) ?? [];
    const nextEntries = [
      ...entries,
      {
        role: "user" as const,
        userName: request.userName,
        text: request.prompt,
        createdAt: now,
      },
      {
        role: "bot" as const,
        userName: this.config.loginChannel,
        text: reply,
        createdAt: now,
      },
    ].slice(
      -Math.max(1, this.config.chatAiConversationHistoryMaxMessages ?? 6)
    );
    this.mentionChatConversationHistory.set(key, nextEntries);
  }

  private _recordStreamCommentConversationHistory(
    channel: string,
    user: string,
    text: string,
    now: number
  ): void {
    if (!(this.config.chatAiConversationHistoryEnabled ?? true)) return;
    if (!isSafeMentionChatConversationContextText(text)) return;

    const userName = normalizeMentionChatUserName(user);
    if (!userName) return;
    if ((this.config.chatAiIgnoredUsers ?? []).includes(userName)) return;

    const key = normalizeMentionChatConversationKey(channel);
    const entries = this.mentionChatConversationHistory.get(key) ?? [];
    const nextEntries = [
      ...entries,
      {
        role: "user" as const,
        userName,
        text,
        createdAt: now,
      },
    ].slice(
      -Math.max(1, this.config.chatAiConversationHistoryMaxMessages ?? 6)
    );
    this.mentionChatConversationHistory.set(key, nextEntries);
  }

  private _nextMentionChatRequestId(): string {
    this.mentionChatRequestSequence += 1;
    return `mention-${Date.now()}-${this.mentionChatRequestSequence}`;
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
      const streamImageBase64: string | null = null;
      const immediateReply = resolveMentionChatImmediateReply(request.prompt);
      if (immediateReply) {
        if (immediateReply.reason === "command_execution") {
          logger.warn(
            `⚠️ AIメンション会話はコマンド実行依頼を拒否: prompt=${formatMentionChatLogValue(request.prompt)}, reply=${formatMentionChatLogValue(immediateReply.reply)}`
          );
        }
        const replyWithEmote = appendContextualChatReplyEmote(
          immediateReply.reply,
          this.config.chatReplyEmotes,
          {
            source: "mention",
            promptText: request.prompt,
          }
        );
        const model = this.config.chatAiModel ?? "";
        logger.info(
          `AIメンション会話応答: user=${request.userName}, alias=${request.alias}, model=${model}, image=false, prompt=${formatMentionChatLogValue(request.prompt)}, reply=${formatMentionChatLogValue(replyWithEmote)}`
        );
        await this.chatClient.say(request.channel, replyWithEmote);
        logger.info(
          `✅ AIメンション会話を送信: user=${request.userName}, alias=${request.alias}`
        );
        return;
      }
      const requestId = this._nextMentionChatRequestId();
      const contextStartedAt = Date.now();
      const memoryEnabled = this.config.chatAiMemoryEnabled ?? false;
      const memoryStore = this.config.chatAiMemoryStore ?? "json";
      const memoryMaxChars = this.config.chatAiMemoryMaxChars ?? 600;
      const memory = loadMentionChatMemoryStore({
        enabled: memoryEnabled,
        store: this.config.chatAiMemoryStore ?? "json",
        jsonPath: this.config.chatAiMemoryPath ?? "",
        sqlitePath: this.config.chatAiMemoryDbPath ?? "",
        maxItems: this.config.chatAiMemoryMaxItems ?? 8,
        maxChars: memoryMaxChars,
        queryText: request.prompt,
        subjectAliases: [request.userName],
        relevanceFilterEnabled:
          this.config.chatAiMemoryRelevanceFilterEnabled ?? true,
      });
      if (memory.text) {
        logger.info(
          `AIメンション会話メモを適用: store=${this.config.chatAiMemoryStore ?? "json"}, items=${memory.itemCount}, chars=${memory.charCount}`
        );
      }
      const authority = memoryEnabled
        ? loadMentionChatMemoryAuthorityStore({
            store: memoryStore,
            jsonPath: this.config.chatAiMemoryPath ?? "",
            sqlitePath: this.config.chatAiMemoryDbPath ?? "",
          })
        : { activeKeys: [], suppressedKeys: [] };
      const mem0Enabled = memoryEnabled && this._isMentionChatMem0Enabled();
      const mem0Requested =
        mem0Enabled &&
        shouldRecallMentionChatMem0Memory(
          request.prompt,
          this.config.chatAiMem0RecallGateEnabled ?? true
        );
      const mem0StartedAt = Date.now();
      const mem0Promise = mem0Requested
        ? loadMentionChatMem0Memory({
            enabled: true,
            apiKey: this.config.chatAiMem0ApiKey ?? "",
            endpoint: this.config.chatAiMem0Endpoint ?? "",
            queryText: request.prompt,
            userId: this.config.chatAiMem0UserId ?? this.config.loginChannel,
            agentId: this.config.chatAiMem0AgentId ?? "twitchRaid",
            appId: this.config.chatAiMem0AppId ?? "twitchRaid",
            timeoutMs: this.config.chatAiMem0TimeoutMs ?? 1_200,
            maxItems: this.config.chatAiMem0MaxResults ?? 3,
            maxChars: this.config.chatAiMem0MaxChars ?? 600,
            minScore: this.config.chatAiMem0MinScore ?? 0.5,
            allowMissingScore:
              this.config.chatAiMem0AllowMissingScore ?? false,
            subjectAliases: [request.userName],
          }).then((result) => ({
            result,
            elapsedMs: Math.max(0, Date.now() - mem0StartedAt),
          }))
        : Promise.resolve({
            result: null,
            elapsedMs: 0,
          });
      const searchEnabled = this.config.chatAiSearchEnabled ?? false;
      const searchCandidate = shouldSearchMentionChat(request.prompt);
      const searchStartedAt = Date.now();
      const searchPromise = fetchMentionChatSearchContextDetailed({
        enabled: searchEnabled,
        provider: this.config.chatAiSearchProvider ?? "duckduckgo",
        endpoint:
          this.config.chatAiSearchEndpoint ?? "https://api.duckduckgo.com/",
        engines: this.config.chatAiSearchEngines ?? "",
        queryText: request.prompt,
        timeoutMs: this.config.chatAiSearchTimeoutMs ?? 2_500,
        maxQueryChars: this.config.chatAiSearchMaxQueryChars ?? 120,
        maxResponseBytes: this.config.chatAiSearchMaxResponseBytes ?? 65_536,
        maxResults: this.config.chatAiSearchMaxResults ?? 3,
      }).then((result) => ({
        result,
        elapsedMs: Math.max(0, Date.now() - searchStartedAt),
      }));
      const [mem0Outcome, searchOutcome] = await Promise.all([
        mem0Promise,
        searchPromise,
      ]);
      const mem0Memory = mem0Outcome.result;
      const mem0Reason = mem0Requested
        ? (mem0Memory?.reason ?? "failed")
        : mem0Enabled
          ? "recall_gate"
          : "disabled";
      const searchContext = searchOutcome.result.context;
      logger.info(
        `AIメンション会話コンテキスト準備: requestId=${requestId}, localItems=${memory.itemCount}, mem0Requested=${mem0Requested}, mem0Reason=${mem0Reason}, mem0Ms=${mem0Outcome.elapsedMs}, searchReason=${searchOutcome.result.reason}, searchResults=${searchContext?.resultCount ?? 0}, searchMs=${searchOutcome.elapsedMs}, totalMs=${Math.max(0, Date.now() - contextStartedAt)}`
      );
      if (mem0Memory?.text) {
        logger.info(
          `AIメンション会話mem0メモを適用: items=${mem0Memory.itemCount}, chars=${mem0Memory.charCount}`
        );
      } else if (
        mem0Requested &&
        mem0Memory &&
        mem0Memory.reason !== "disabled" &&
        mem0Memory.reason !== "empty"
      ) {
        logger.info(
          `AIメンション会話mem0メモは未適用: reason=${mem0Memory.reason}`
        );
      }
      const combinedMemory = combineMentionChatMemoryText(
        memory.text,
        mem0Memory?.text,
        {
          mem0Items: mem0Memory?.items,
          authority,
          maxChars: memoryMaxChars,
        }
      );
      if (combinedMemory.dedupedMem0ItemCount > 0) {
        logger.info(
          `AIメンション会話mem0メモ重複を除外: items=${combinedMemory.dedupedMem0ItemCount}`
        );
      }
      const combinedMemoryText = combinedMemory.text;
      const conversationHistory = shouldApplyMentionChatConversationHistory(
        request.prompt
      )
        ? this._getMentionChatConversationHistory(request.channel, now)
        : null;
      if (conversationHistory) {
        logger.info(
          `AIメンション会話履歴を適用: items=${conversationHistory.itemCount}, chars=${conversationHistory.charCount}`
        );
      }
      if (searchContext) {
        logger.info(
          `AIメンション会話外部検索を適用: results=${searchContext.resultCount}`
        );
      } else if (searchCandidate) {
        logger.info(
          `AIメンション会話外部検索は未適用: reason=${searchOutcome.result.reason}`
        );
        if (searchOutcome.result.reason === "no_result") {
          const replyWithEmote = appendContextualChatReplyEmote(
            MENTION_CHAT_SEARCH_NO_RESULT_REPLY,
            this.config.chatReplyEmotes,
            {
              source: "mention",
              promptText: request.prompt,
            }
          );
          const model = this.config.chatAiModel ?? "";
          logger.info(
            `AIメンション会話応答: user=${request.userName}, alias=${request.alias}, model=${model}, image=false, prompt=${formatMentionChatLogValue(request.prompt)}, reply=${formatMentionChatLogValue(replyWithEmote)}`
          );
          await this.chatClient.say(request.channel, replyWithEmote);
          logger.info(
            `✅ AIメンション会話を送信: user=${request.userName}, alias=${request.alias}`
          );
          return;
        }
      }
      const model = this.config.chatAiModel ?? "";
      const promptLogValue = isMentionChatMemoryRequest(request.prompt)
        ? MENTION_CHAT_MEMORY_REQUEST_LOG_VALUE
        : request.prompt;
      let generatedReply = await generateMentionChatReplyDetailed({
        enabled: true,
        baseUrl: this.config.chatAiBaseUrl ?? this.config.ollamaBaseUrl,
        model,
        timeoutMs: this.config.chatAiTimeoutMs ?? 8_000,
        timeoutFallbackReply: this.config.chatAiTimeoutFallbackReply,
        keepAlive: this.config.chatAiKeepAlive ?? "30m",
        contextLength: this.config.chatAiContextLength ?? 4096,
        requestId,
        maxResponseChars:
          this.config.chatAiMaxResponseChars ??
          DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS,
        channel: request.channel,
        userName: request.userName,
        userDisplayName: request.userDisplayName,
        promptText: request.prompt,
        redactedPromptText: promptLogValue,
        memoryText: combinedMemoryText,
        conversationHistoryText: conversationHistory?.text,
        searchContextText: searchContext?.text,
        streamImageBase64,
        promptReplyLogEnabled: this.config.chatAiPromptReplyLogEnabled ?? false,
      });

      if (
        generatedReply?.source === "generated" &&
        !searchContext &&
        searchEnabled &&
        searchOutcome.result.reason !== "failed" &&
        shouldResearchMentionChatReply(generatedReply.reply)
      ) {
        const researchSearchContext = await fetchMentionChatSearchContext({
          enabled: true,
          provider: this.config.chatAiSearchProvider ?? "duckduckgo",
          endpoint:
            this.config.chatAiSearchEndpoint ?? "https://api.duckduckgo.com/",
          engines: this.config.chatAiSearchEngines ?? "",
          queryText: request.prompt,
          force: true,
          timeoutMs: this.config.chatAiSearchTimeoutMs ?? 2_500,
          maxQueryChars: this.config.chatAiSearchMaxQueryChars ?? 120,
          maxResponseBytes: this.config.chatAiSearchMaxResponseBytes ?? 65_536,
          maxResults: this.config.chatAiSearchMaxResults ?? 3,
        });

        if (researchSearchContext) {
          logger.info(
            `AIメンション会話リサーチ検索を適用: results=${researchSearchContext.resultCount}`
          );
          const researchedReply = await generateMentionChatReplyDetailed({
            enabled: true,
            baseUrl: this.config.chatAiBaseUrl ?? this.config.ollamaBaseUrl,
            model,
            timeoutMs: this.config.chatAiTimeoutMs ?? 8_000,
            timeoutFallbackReply: this.config.chatAiTimeoutFallbackReply,
            keepAlive: this.config.chatAiKeepAlive ?? "30m",
            contextLength: this.config.chatAiContextLength ?? 4096,
            requestId,
            maxResponseChars:
              this.config.chatAiMaxResponseChars ??
              DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS,
            channel: request.channel,
            userName: request.userName,
            userDisplayName: request.userDisplayName,
            promptText: request.prompt,
            redactedPromptText: promptLogValue,
            memoryText: combinedMemoryText,
            conversationHistoryText: conversationHistory?.text,
            searchContextText: researchSearchContext.text,
            streamImageBase64,
            promptReplyLogEnabled:
              this.config.chatAiPromptReplyLogEnabled ?? false,
          });

          if (researchedReply?.source === "generated") {
            generatedReply = researchedReply;
          }
        } else {
          logger.info(
            "AIメンション会話リサーチ検索は未適用: reason=no_result_or_failed"
          );
        }
      }

      if (!generatedReply) {
        logger.warn(
          `⚠️ AIメンション会話は返信なし: user=${request.userName}, alias=${request.alias}`
        );
        return;
      }
      const reply = generatedReply.reply;

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
      if (generatedReply.source === "generated") {
        this._recordMentionChatConversationHistory(
          request,
          reply,
          now
        );
      }
      this._scheduleImplicitMentionChatMemorySave(request);
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
      case "7days":
        await this.chatClient.say(channel, SEVEN_DAYS_IMAGE_ALBUM_MESSAGE);
        break;
      case "die":
        await this.chatClient.say(channel, DIE_SURVIVAL_REPLY);
        break;
      case "work":
        await this.chatClient.say(channel, WORK_SEND_OFF_REPLY);
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
          Date.now() / 1000,
          getChatMessageDisplayName(msg)
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
          helixClientId: this.config.twitchClientId,
          helixAccessToken: this.config.twitchAccessToken,
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
          helixClientId: this.config.twitchClientId,
          helixAccessToken: this.config.twitchAccessToken,
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
          helixClientId: this.config.twitchClientId,
          helixAccessToken: this.config.twitchAccessToken,
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
      info = await fetchRaidSourceInfo(this.apiClient, username, {
        helixClientId: this.config.twitchClientId,
        helixAccessToken: this.config.twitchAccessToken,
      });
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
          deferTrimming: true,
        }
      );
      const finalMessage = shortenRaidGreetingKeepingUrl(
        messageWithEmote,
        info.streamUrl,
        GENERATED_RAID_GREETING_LIMIT
      );
      await this.chatClient.say(channel, finalMessage);
      logger.info(
        `✅ Raid挨拶文を送信: target=${info.userName}, viewerCount=${viewerCount}, message=${formatMentionChatLogValue(finalMessage)}`
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
    const tokenRefreshThresholdSeconds = 5 * 60; // 期限5分前
    let lastTokenRefresh = Date.now() / 1000;

    void this._prewarmChatAiModel("startup");

    this.keepAliveTimer = setInterval(async () => {
      try {
        const now = Date.now() / 1000;

        const secondsUntilExpiry = getAccessTokenSecondsUntilExpiry(this.config);
        if (
          secondsUntilExpiry !== null &&
          secondsUntilExpiry <= tokenRefreshThresholdSeconds
        ) {
          const previousToken = this.config.twitchAccessToken;
          const refreshedToken = await refreshAccessTokenIfExpiringSoon(
            this.config,
            tokenRefreshThresholdSeconds
          );
          if (refreshedToken && refreshedToken !== previousToken) {
            lastTokenRefresh = now;
            logger.info("✅ 期限前トークンリフレッシュ完了");
          }
        }

        // 定期トークンリフレッシュ（期限情報がない場合の保険）
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

        await this._sendBotRequestNotesDigestIfDue(now);

        if (this._shouldPrewarmChatAiModel(now)) {
          void this._prewarmChatAiModel("interval");
        }
      } catch (e) {
        logger.error(`❌ キープアライブ中にエラー: ${e}`);
      }
    }, connectionCheckInterval);
  }

  private _shouldPrewarmChatAiModel(now: number): boolean {
    if (
      !this.config.chatAiPrewarmEnabled ||
      !this.config.chatAiEnabled ||
      !this.config.chatAiModel
    ) {
      return false;
    }
    const intervalSeconds = this.config.chatAiPrewarmIntervalSeconds ?? 600;
    return now - this.lastChatAiPrewarmAt >= intervalSeconds;
  }

  private async _prewarmChatAiModel(
    trigger: "startup" | "interval"
  ): Promise<void> {
    if (
      !this.config.chatAiPrewarmEnabled ||
      !this.config.chatAiEnabled ||
      !this.config.chatAiModel ||
      this.chatAiPrewarmInFlight
    ) {
      return;
    }

    this.chatAiPrewarmInFlight = true;
    const runStartupOnly =
      trigger === "startup" && !this.chatAiStartupOnlyPrewarmAttempted;
    if (runStartupOnly) this.chatAiStartupOnlyPrewarmAttempted = true;
    try {
      const model = this.config.chatAiModel;
      const embedModel = this.config.chatAiMem0EmbedModel ?? "";
      const baseUrl = this.config.chatAiBaseUrl ?? this.config.ollamaBaseUrl;
      const timeoutMs = this.config.chatAiPrewarmTimeoutMs ?? 180_000;
      const keepAlive = this.config.chatAiKeepAlive ?? "30m";
      const result = await prewarmOllamaGenerateModel({
        enabled: true,
        baseUrl,
        model,
        timeoutMs,
        keepAlive,
      });
      this.lastChatAiPrewarmAt = Date.now() / 1000;
      if (result.status === "warmed") {
        logger.info(
          `AIメンション会話モデルprewarm完了: trigger=${trigger}, model=${formatMentionChatLogValue(model)}, elapsedMs=${result.elapsedMs}, keepAlive=${formatMentionChatLogValue(keepAlive)}`
        );
      } else if (result.status === "failed") {
        logger.warn(
          `AIメンション会話モデルprewarm失敗: trigger=${trigger}, reason=${result.reason}, model=${formatMentionChatLogValue(model)}, timeoutMs=${timeoutMs}, elapsedMs=${result.elapsedMs}, detail=${formatMentionChatLogValue(result.detail)}`
        );
      }
      if (result.status !== "warmed") return;

      if (runStartupOnly && (this.config.chatAiPrewarmPrimeEnabled ?? false)) {
        const primeRequest = buildMentionChatPrewarmRequest(
          this.config.chatAiMaxResponseChars ?? DEFAULT_CHAT_AI_MAX_RESPONSE_CHARS
        );
        const primeResult = await primeOllamaGenerateModel({
          enabled: true,
          baseUrl,
          model,
          timeoutMs,
          keepAlive,
          contextLength: this.config.chatAiContextLength ?? 4_096,
          systemPrompt: primeRequest.systemPrompt,
          prompt: primeRequest.prompt,
        });
        if (primeResult.status === "warmed") {
          logger.info(
            `AIメンション会話モデルprime完了: trigger=${trigger}, model=${formatMentionChatLogValue(model)}, elapsedMs=${primeResult.elapsedMs}`
          );
        } else if (primeResult.status === "failed") {
          logger.warn(
            `AIメンション会話モデルprime失敗: trigger=${trigger}, reason=${primeResult.reason}, model=${formatMentionChatLogValue(model)}, timeoutMs=${timeoutMs}, elapsedMs=${primeResult.elapsedMs}, detail=${formatMentionChatLogValue(primeResult.detail)}`
          );
        }
        if (primeResult.status !== "warmed") return;
      }

      const embedResult = await prewarmOllamaEmbedModel({
        enabled: this.config.chatAiMem0EmbedPrewarmEnabled ?? false,
        baseUrl,
        model: embedModel,
        timeoutMs,
      });
      if (embedResult.status === "warmed") {
        logger.info(
          `AIメンション会話mem0埋め込みモデルprewarm完了: trigger=${trigger}, model=${formatMentionChatLogValue(embedModel)}, elapsedMs=${embedResult.elapsedMs}`
        );
      } else if (embedResult.status === "failed") {
        logger.warn(
          `AIメンション会話mem0埋め込みモデルprewarm失敗: trigger=${trigger}, reason=${embedResult.reason}, model=${formatMentionChatLogValue(embedModel)}, timeoutMs=${timeoutMs}, elapsedMs=${embedResult.elapsedMs}, detail=${formatMentionChatLogValue(embedResult.detail)}`
        );
      }
      if (embedResult.status === "failed") return;
      if (
        (this.config.chatAiMem0EmbedPrewarmEnabled ?? false) &&
        embedResult.status !== "warmed"
      ) {
        return;
      }

      if (
        runStartupOnly &&
        (this.config.chatAiMem0SearchPrewarmEnabled ?? false) &&
        (this.config.chatAiMemoryEnabled ?? false) &&
        this._isMentionChatMem0Enabled()
      ) {
        const mem0StartedAt = Date.now();
        const mem0Result = await loadMentionChatMem0Memory({
          enabled: true,
          endpoint: this.config.chatAiMem0Endpoint ?? "",
          apiKey: this.config.chatAiMem0ApiKey ?? "",
          queryText: "好きな食べ物なんだっけ？",
          userId: this.config.chatAiMem0UserId ?? this.config.loginChannel,
          agentId: this.config.chatAiMem0AgentId ?? "twitchRaid",
          timeoutMs,
          maxItems: 1,
          maxChars: 1,
          minScore: 1,
          allowMissingScore: false,
        });
        const elapsedMs = Math.max(0, Date.now() - mem0StartedAt);
        if (mem0Result.reason === "found" || mem0Result.reason === "empty") {
          logger.info(
            `AIメンション会話mem0検索prewarm完了: trigger=${trigger}, reason=${mem0Result.reason}, items=${mem0Result.itemCount}, elapsedMs=${elapsedMs}`
          );
        } else {
          logger.warn(
            `AIメンション会話mem0検索prewarm失敗: trigger=${trigger}, reason=${mem0Result.reason}, timeoutMs=${timeoutMs}, elapsedMs=${elapsedMs}`
          );
        }
      }
    } finally {
      this.chatAiPrewarmInFlight = false;
    }
  }

  private async _sendBotRequestNotesDigestIfDue(now: number): Promise<void> {
    if (!(this.config.botRequestNotesEnabled ?? false)) return;
    if (!(this.config.botRequestNotesDigestEnabled ?? false)) return;
    if (this.botRequestNotesDigestInFlight) return;

    const nowIso = new Date(now * 1000).toISOString();
    const digest = buildBotRequestNotesDigest({
      enabled: true,
      dbPath: this.config.botRequestNotesDbPath ?? "",
      intervalHours: this.config.botRequestNotesDigestIntervalHours ?? 168,
      maxItems: this.config.botRequestNotesDigestMaxItems ?? 10,
      now: () => nowIso,
    });
    if (!digest.shouldSend || !digest.message) return;

    const channelId =
      this.config.botRequestNotesDiscordChannelId ||
      this.config.discordSummaryChannelId;
    const botToken = this.config.discordBotToken;
    const webhookUrl = this.config.discordWebhookUrl;
    const discordEnabled = this.config.botRequestNotesDigestDiscordEnabled;

    this.botRequestNotesDigestInFlight = true;
    try {
      const fileResult = writeBotRequestNotesDigestFile({
        filePath: this.config.botRequestNotesDigestFilePath,
        generatedAt: nowIso,
        entries: digest.entries,
      });
      if (!fileResult.written) {
        throw new Error(
          `Bot request notes digest file write failed: reason=${fileResult.reason}`
        );
      }

      let sentToDiscord = false;
      if (discordEnabled) {
        if (botToken && channelId) {
          try {
            await sendDiscordBotMessage({
              botToken,
              channelId,
              content: digest.message,
            });
          } catch (botError) {
            if (!webhookUrl) throw botError;
            logger.info(
              `Bot要望メモdigest Bot API送信に失敗したためWebhookへフォールバック: ${botError}`
            );
            try {
              await executeDiscordWebhook(webhookUrl, { content: digest.message });
            } catch (webhookError) {
              throw new Error(
                `Discord bot message failed and webhook fallback failed: bot=${botError}; webhook=${webhookError}`
              );
            }
          }
          sentToDiscord = true;
        } else if (webhookUrl) {
          await executeDiscordWebhook(webhookUrl, { content: digest.message });
          sentToDiscord = true;
        } else {
          throw new Error("Discord digest destination is missing");
        }
      }

      markBotRequestNotesDigestSent({
        dbPath: this.config.botRequestNotesDbPath ?? "",
        sentAt: nowIso,
      });
      logger.info(
        `Bot要望メモdigestを${sentToDiscord ? "送信" : "ファイル保存"}: items=${digest.itemCount}, path=${formatMentionChatLogValue(this.config.botRequestNotesDigestFilePath)}`
      );
    } catch (e) {
      logger.warn(`⚠️ Bot要望メモdigest送信に失敗しました: ${e}`);
    } finally {
      this.botRequestNotesDigestInFlight = false;
    }
  }

  private _chatChannel(): string {
    return this.config.loginChannel.startsWith("#")
      ? this.config.loginChannel
      : `#${this.config.loginChannel}`;
  }

  private _startStreamMonitor(): void {
    if (this.streamMonitorTimer) clearInterval(this.streamMonitorTimer);

    this._startStreamEventSub();
    void this._checkStreamStatus();
    this.streamMonitorTimer = setInterval(
      () => void this._checkStreamStatus(),
      STREAM_STATUS_POLL_INTERVAL_MS
    );
  }

  private _startStreamEventSub(): void {
    if (this.streamEventSubListener) return;

    const broadcasterId = (this.config.twitchBroadcasterId ?? "").trim();
    if (!broadcasterId) {
      logger.warn("⚠️ Twitch broadcaster ID未設定のため、配信検知は60秒ポーリングで継続します。");
      return;
    }

    try {
      const eventSubApiClient = new ApiClient({
        authProvider: createEventSubAuthProvider(
          this.authProvider,
          this.botUserId
        ),
      });
      const listener = this.streamEventSubListenerFactory(eventSubApiClient);
      listener.onStreamOnline(broadcasterId, () => {
        logger.info("⚡ Twitch EventSubで配信開始を受信しました。");
        void this._checkStreamStatus();
      });
      listener.onStreamOffline(broadcasterId, () => {
        logger.info("⚡ Twitch EventSubで配信終了を受信しました。");
        void this._checkStreamStatus();
      });
      listener.onSubscriptionCreateFailure((_subscription, error) => {
        logger.warn(
          `⚠️ Twitch EventSub購読作成に失敗しました。60秒ポーリングで継続します: ${error.name}`
        );
      });
      listener.onSubscriptionCreateSuccess((subscription) => {
        logger.info(`✅ Twitch EventSub購読作成成功: id=${subscription.id}`);
      });
      listener.onRevoke((_subscription, status) => {
        logger.warn(
          `⚠️ Twitch EventSub購読が無効化されました。60秒ポーリングで継続します: status=${status}`
        );
      });
      listener.start();
      this.streamEventSubListener = listener;
      logger.info("✅ Twitch EventSub配信開始・終了監視を開始しました。");
    } catch (error) {
      logger.warn(
        `⚠️ Twitch EventSub監視を開始できませんでした。60秒ポーリングで継続します: ${error instanceof Error ? error.name : "unknown_error"}`
      );
    }
  }

  private _checkStreamStatus(): Promise<void> {
    if (this.streamStatusCheckInFlight) {
      this.streamStatusCheckRerunRequested = true;
      return this.streamStatusCheckInFlight;
    }

    const attempt = (async () => {
      do {
        this.streamStatusCheckRerunRequested = false;
        await this._checkStreamStatusOnce();
      } while (this.streamStatusCheckRerunRequested);
    })();
    const trackedAttempt = attempt.finally(() => {
      if (this.streamStatusCheckInFlight === trackedAttempt) {
        this.streamStatusCheckInFlight = null;
      }
    });
    this.streamStatusCheckInFlight = trackedAttempt;
    return trackedAttempt;
  }

  private async _checkStreamStatusOnce(): Promise<void> {
    const maxErrors = 5;
    try {
      const stream = await this.apiClient.streams.getStreamByUserName(
        this.config.loginChannel
      );

      if (stream) {
        if (!this.streamLive) {
          logger.info(`🎥 配信が開始されました！タイトル: ${stream.title}`);
          const newlyDetectedStream = await this._handleStreamStarted(stream);
          this.streamLive = true;
          await this._notifyStreamStartedOnDiscord(stream, {
            newlyDetectedStream,
          });
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

      this.streamStatusErrorCount = 0;
    } catch (error) {
      this.streamStatusErrorCount++;
      logger.error(
        `⚠️ 配信状態チェックエラー (${this.streamStatusErrorCount}/${maxErrors}): ${error}`
      );

      if (this.streamStatusErrorCount >= maxErrors) {
        logger.warn("🔄 エラーが続くため、トークンを自動更新します...");
        const newToken = await refreshAccessTokenAdvanced(this.config);
        if (newToken) {
          this.streamStatusErrorCount = 0;
          logger.info("✅ トークン更新完了。監視を継続します。");
        }
      }
    }
  }

  private async _handleStreamStarted(stream: {
    id: string;
    title: string;
    gameName?: string;
    startDate: Date;
  }): Promise<boolean> {
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
      return true;
    }

    if (!this.streamLive) {
      this.recommendationNotifier.reset(startedAt, Date.now() / 1000);
    }
    this.commentSpeedMeter.ensureStreamStarted(startedAt);
    this.streamSummaryStateStore.updateCounts(
      this.commentSpeedMeter.totalCount(),
      existing.raidCount
    );
    return false;
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
  }, options: { newlyDetectedStream?: boolean } = {}): Promise<void> {
    let notificationAttempted = false;
    await this.streamNotifier.notifyIfNeeded(
      this._streamNotificationDetails(stream),
      async (message) => {
        notificationAttempted = true;
        const started = await this._ensureStreamStartSummaryThread(
          stream.title,
          message,
          {
            allowStartNotificationRepost: true,
            postStartNotificationImmediately: options.newlyDetectedStream === true,
          }
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
        {
          allowStartNotificationRepost: true,
          postStartNotificationImmediately:
            options.newlyDetectedStream === true && !notificationAttempted,
        }
      );
    }
  }

  private _ensureStreamStartSummaryThread(
    title: string,
    message: DiscordWebhookPayload,
    options: {
      allowStartNotificationRepost?: boolean;
      postStartNotificationImmediately?: boolean;
    } = {}
  ): Promise<StartStreamSummaryThreadResult> {
    if (!this._canPostDiscordSummary()) return Promise.resolve({});

    const key = this._streamSummaryThreadEnsureKey(title);
    const inFlight = this.streamSummaryThreadEnsureInFlight.get(key);
    if (inFlight) return inFlight;

    const retryState = this.streamSummaryThreadRetryState.get(key);
    if (retryState && Date.now() < retryState.nextRetryAt) {
      return Promise.resolve({});
    }

    const attempt = this._ensureStreamStartSummaryThreadOnce(
      title,
      message,
      options
    ).then(
      (started) => {
        this.streamSummaryThreadRetryState.delete(key);
        return started;
      },
      (error: unknown) => {
        this._recordStreamSummaryThreadRetry(key, error);
        return {};
      }
    );

    const trackedAttempt = attempt.finally(() => {
      if (this.streamSummaryThreadEnsureInFlight.get(key) === trackedAttempt) {
        this.streamSummaryThreadEnsureInFlight.delete(key);
      }
    });
    this.streamSummaryThreadEnsureInFlight.set(key, trackedAttempt);
    return trackedAttempt;
  }

  private _streamSummaryThreadEnsureKey(title: string): string {
    return JSON.stringify([
      this.config.discordSummaryChannelId || "",
      buildStreamSummaryThreadName(title),
    ]);
  }

  private _recordStreamSummaryThreadRetry(key: string, error: unknown): void {
    const previousFailureCount =
      this.streamSummaryThreadRetryState.get(key)?.failureCount ?? 0;
    const failureCount = previousFailureCount + 1;
    const discordError =
      error instanceof DiscordHistoryLookupError ||
      error instanceof DiscordApiRequestError
        ? error
        : null;
    const rateLimitRetryAfterMs =
      discordError?.status === 429 &&
      typeof discordError.retryAfterMs === "number" &&
      Number.isFinite(discordError.retryAfterMs) &&
      discordError.retryAfterMs >= 0
        ? discordError.retryAfterMs
        : undefined;
    const retryDelayMs =
      rateLimitRetryAfterMs !== undefined
        ? Math.ceil(rateLimitRetryAfterMs)
        : Math.min(
            STREAM_SUMMARY_THREAD_RETRY_INITIAL_MS *
              2 ** Math.max(0, failureCount - 1),
            STREAM_SUMMARY_THREAD_RETRY_MAX_MS
          );
    this.streamSummaryThreadRetryState.set(key, {
      failureCount,
      nextRetryAt: Date.now() + retryDelayMs,
    });
    logger.warn(
      `⚠️ 配信まとめスレッド復旧を再試行待ちにしました: reason=${discordError?.reason ?? "unexpected_failure"}, status=${discordError?.status ?? "none"}, retryAfterMs=${retryDelayMs}`
    );
  }

  private async _ensureStreamStartSummaryThreadOnce(
    title: string,
    message: DiscordWebhookPayload,
    options: {
      allowStartNotificationRepost?: boolean;
      postStartNotificationImmediately?: boolean;
    } = {}
  ): Promise<StartStreamSummaryThreadResult> {
    if (!this._canPostDiscordSummary()) return {};

    const state = this.streamSummaryStateStore.load();
    if (!state || state.status === "posted") return {};

    let persistedStartMessageId: string | undefined;
    const started = await this.streamSummaryThreadEnsurer({
      webhookUrl: this.config.discordWebhookUrl || undefined,
      botToken: this.config.discordBotToken || undefined,
      channelId: this.config.discordSummaryChannelId || undefined,
      webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
        ? buildStreamSummaryThreadName(title)
        : undefined,
      title,
      message,
      state,
      allowStartNotificationRepost: options.allowStartNotificationRepost,
      postStartNotificationImmediately: options.postStartNotificationImmediately,
      canPostStartNotification: () => {
        const latest = this.streamSummaryStateStore.load();
        return Boolean(
          latest && latest.status === "active" && latest.streamId === state.streamId
        );
      },
      persistStartMessage: (startMessageId) => {
        this._persistStreamSummaryStartMessage(
          state.streamId,
          startMessageId,
          {
            expectedIds: {
              startMessageId: state.startMessageId,
              threadId: state.threadId,
            },
          }
        );
        persistedStartMessageId = startMessageId;
      },
    });

    if (!started.startMessageId && !started.threadId) return started;

    const latest = this.streamSummaryStateStore.load();
    if (!latest || latest.streamId !== state.streamId) {
      logger.warn(
        `⚠️ 配信まとめスレッド情報の競合を検出し、旧配信の結果を破棄しました: streamId=${state.streamId}`
      );
      return {};
    }

    const stillOwnsInitialIds =
      latest.startMessageId === state.startMessageId &&
      latest.threadId === state.threadId;
    const stillOwnsPersistedStart =
      persistedStartMessageId !== undefined &&
      latest.startMessageId === persistedStartMessageId &&
      (latest.threadId === undefined || latest.threadId === started.threadId);
    if (
      latest.status === "posted" ||
      (!stillOwnsInitialIds && !stillOwnsPersistedStart)
    ) {
      logger.warn(
        `⚠️ 配信まとめスレッド情報の競合を検出し、最新stateを維持しました: streamId=${state.streamId}, startMessageId=${latest.startMessageId ?? "none"}, threadId=${latest.threadId ?? "none"}`
      );
      return {
        startMessageId: latest.startMessageId,
        threadId: latest.threadId,
        postedStartNotification: false,
      };
    }

    this.streamSummaryStateStore.save(
      mergeStreamStartThreadResult(latest, started)
    );

    if (
      !started.postedStartNotification &&
      (started.startMessageId !== state.startMessageId ||
        started.threadId !== state.threadId)
    ) {
      logger.info(
        `✅ 配信まとめスレッド情報を復旧しました: streamId=${state.streamId}, startMessageId=${started.startMessageId ?? "none"}, threadId=${started.threadId ?? "none"}`
      );
    }
    return started;
  }

  private _persistStreamSummaryStartMessage(
    expectedStreamId: string,
    startMessageId: string,
    options: {
      preferStartedThread?: boolean;
      expectedIds?: {
        startMessageId?: string;
        threadId?: string;
      };
    } = {}
  ): void {
    const latest = this.streamSummaryStateStore.load();
    if (
      !latest ||
      latest.status === "posted" ||
      latest.streamId !== expectedStreamId
    ) {
      throw new Error(
        "Active stream summary state changed before start message persistence"
      );
    }

    if (
      options.expectedIds &&
      (latest.startMessageId !== options.expectedIds.startMessageId ||
        latest.threadId !== options.expectedIds.threadId)
    ) {
      throw new Error(
        "Active stream summary start ids changed before start message persistence"
      );
    }

    this.streamSummaryStateStore.save(
      mergeStreamStartThreadResult(
        latest,
        { startMessageId },
        { preferStartedThread: options.preferStartedThread }
      )
    );
  }

  private async _forceStreamStartSummaryThread(
    title: string,
    message: DiscordWebhookPayload
  ): Promise<StartStreamSummaryThreadResult> {
    const key = this._streamSummaryThreadEnsureKey(title);
    while (true) {
      const inFlight = this.streamSummaryThreadEnsureInFlight.get(key);
      if (!inFlight) break;
      if (this.streamSummaryManualForceInFlightKeys.has(key)) return inFlight;
      await inFlight;
    }

    const forceAttempt = this._forceStreamStartSummaryThreadOnce(
      title,
      message
    ).then(
      (started) => {
        this.streamSummaryThreadRetryState.delete(key);
        return started;
      },
      (error: unknown) => {
        this._recordStreamSummaryThreadRetry(key, error);
        throw error;
      }
    );
    const trackedForceAttempt = forceAttempt.finally(() => {
      if (
        this.streamSummaryThreadEnsureInFlight.get(key) === trackedForceAttempt
      ) {
        this.streamSummaryThreadEnsureInFlight.delete(key);
        this.streamSummaryManualForceInFlightKeys.delete(key);
      }
    });
    this.streamSummaryManualForceInFlightKeys.add(key);
    this.streamSummaryThreadEnsureInFlight.set(key, trackedForceAttempt);
    return trackedForceAttempt;
  }

  private async _forceStreamStartSummaryThreadOnce(
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

    let persistedStartMessageId: string | undefined;
    const started = await startStreamSummaryThread({
      webhookUrl: this.config.discordWebhookUrl || undefined,
      botToken: this.config.discordBotToken || undefined,
      channelId: this.config.discordSummaryChannelId || undefined,
      webhookThreadName: this.config.discordSummaryWebhookThreadEnabled
        ? buildStreamSummaryThreadName(title)
        : undefined,
      title,
      message,
      persistStartMessage: (startMessageId) => {
        this._persistStreamSummaryStartMessage(state.streamId, startMessageId, {
          preferStartedThread: true,
          expectedIds: {
            startMessageId: state.startMessageId,
            threadId: state.threadId,
          },
        });
        persistedStartMessageId = startMessageId;
      },
    });

    if (!started.startMessageId && !started.threadId) {
      throw new Error("Discord start notification did not return message or thread id");
    }

    const latest = this.streamSummaryStateStore.load();
    if (!latest || latest.streamId !== state.streamId) {
      throw new Error("Active stream summary state changed before thread persistence");
    }
    const stillOwnsInitialIds =
      latest.startMessageId === state.startMessageId &&
      latest.threadId === state.threadId;
    const stillOwnsPersistedStart =
      persistedStartMessageId !== undefined &&
      latest.startMessageId === persistedStartMessageId &&
      (latest.threadId === undefined || latest.threadId === started.threadId);
    if (
      latest.status === "posted" ||
      (!stillOwnsInitialIds && !stillOwnsPersistedStart)
    ) {
      logger.warn(
        `⚠️ 手動配信開始通知の保存競合を検出し、最新stateを維持しました: streamId=${state.streamId}, startMessageId=${latest.startMessageId ?? "none"}, threadId=${latest.threadId ?? "none"}`
      );
      return {
        startMessageId: latest.startMessageId,
        threadId: latest.threadId,
        postedStartNotification: false,
      };
    }
    this.streamSummaryStateStore.save(
      mergeStreamStartThreadResult(latest, started, {
        preferStartedThread: true,
      })
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
      { allowStartNotificationRepost: state.status === "active" }
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
      if (current.status === "active" && current.threadId) {
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
          ? buildStreamSummaryThreadName(pending.title)
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
