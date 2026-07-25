# AnythingLLMによるチャンネル共通会話記憶への移行

## Problem Statement

twitchRaidのAI会話は、短期履歴が一部の追跡表現でしか適用されず、Botプロセスの再起動でも失われる。プロフィール記憶はSQLiteとMem0へ保存されていても、主体・話題・件数上限によって回答へ取り出されない場合がある。また、「調べて」のように対象を省略した検索依頼は、同一プロセスの直前履歴が残っていなければ検索されない。

その結果、Botが同じ説明や質問を繰り返す、過去の発言を覚えていないように見える、検索を依頼しても検索しない、という利用者体験になっている。

## Solution

AI会話と長期的なチャンネル記憶をself-host AnythingLLMへ移行する。Botはチャンネルの全コメントを、Bot宛てかどうかや内容による事前選別をせず、発言者と時刻を含む会話記憶として非同期保存する。コメント原文は365日保持し、配信単位の要約と事実記憶は無期限で保持する。

`!chat`とBot宛てメンションはAnythingLLMのworkspace chat APIへ送り、AnythingLLMがチャンネル記憶と文書RAGを検索してプロンプトを構築し、既存のself-host Ollamaで回答を生成する。誰のコメントでも、誰への回答にも参照できるチャンネル共通記憶とする。発言者名はアクセス制限ではなく、発言の出典として保持する。

固定コマンド、Raid挨拶、配信通知などAI会話以外の機能は維持する。現行SQLiteとself-host Mem0は、データ移行と本番評価が完了した後に撤去する。

## User Stories

1. As a viewer, I want the Bot to remember earlier conversation topics, so that I do not need to repeat the same explanation.
2. As a viewer, I want a short direct reply such as「マグロだよ」to be understood in the context of the Bot's previous question.
3. As a viewer, I want conversation context to survive Bot restarts and deployments.
4. As a viewer, I want「調べて」to reuse the relevant previous topic even after the Bot process has restarted.
5. As a viewer, I want an explicit research request with a subject to actually perform an external search.
6. As a viewer, I want the Bot to distinguish between no search result and a search service failure.
7. As a viewer, I want the Bot to use comments from any participant when they are relevant to the current conversation.
8. As a viewer, I want the Bot to retain who said each comment, so that it does not silently attribute one viewer's statement to another.
9. As a viewer, I want old comments to remain useful through stream summaries after their raw retention period ends.
10. As a viewer, I want normal comments to be remembered without triggering an unsolicited Bot reply.
11. As a streamer, I want every channel comment to enter the shared conversation memory without command- or mention-based selection.
12. As a streamer, I want raw comments retained for 365 days.
13. As a streamer, I want one durable summary per stream retained without an expiry date.
14. As a streamer, I want durable facts retained without an expiry date.
15. As a streamer, I want the AnythingLLM management UI to inspect and administratively remove documents when necessary.
16. As a streamer, I do not want viewer-facing memory opt-out, deletion, or re-enable commands added.
17. As a streamer, I want existing SQLite and Mem0 memories migrated before those services are removed.
18. As a streamer, I want fixed Twitch commands and non-AI notification behavior to remain unchanged.
19. As an operator, I want AnythingLLM to run entirely on the sub-PC and internal Docker network.
20. As an operator, I want the existing Ollama generation and embedding models reused, so that no hosted model cost is introduced.
21. As an operator, I want AnythingLLM and its data stores pinned to reproducible versions and persistent storage.
22. As an operator, I want API keys and stored comments excluded from normal console logs.
23. As an operator, I want ingestion to be idempotent, so that reconnects and retries do not duplicate comments.
24. As an operator, I want failed ingestion durably queued and retried without blocking Twitch chat handling or silently dropping comments.
25. As an operator, I want retention cleanup to be restart-safe and observable.
26. As an operator, I want AnythingLLM failure to degrade predictably without affecting fixed commands.
27. As an operator, I want retrieved comments treated as untrusted reference data rather than executable instructions.
28. As an operator, I want answer latency, retrieval counts, ingestion lag, queue depth, and failure reasons observable without logging comment bodies.
29. As an operator, I want a no-send production probe that exercises AnythingLLM retrieval and Ollama generation without posting to Twitch or writing user memory.
30. As an operator, I want rollback to the current AI conversation path until the AnythingLLM cutover gates have passed.
31. As a maintainer, I want the integration isolated behind a small adapter so that AnythingLLM API changes do not spread through the Bot.
32. As a maintainer, I want the integration tests to use the pinned instance's OpenAPI contract as the source of truth.
33. As a maintainer, I want current behavior contracts for fixed replies, song generation, English repair, length limits, and emote formatting preserved.
34. As a maintainer, I want the migration to remain green at every tracer-bullet step.
35. As a viewer, I want a comment immediately preceding an AI request to be available to that response even if the normal ingestion batch has not run yet.

## Implementation Decisions

- The runtime path is `Twitch Bot -> AnythingLLM -> Ollama`.
- AnythingLLM Docker image tag `1.15.0` is self-hosted on the sub-PC, pinned by image digest, and reachable only through the existing internal application network.
- AnythingLLM uses the existing Ollama service for both answer generation and embeddings. No hosted LLM, hosted embedding provider, or AnythingLLM Cloud service is used.
- AnythingLLM uses the existing Qdrant service with data isolated from the current Mem0 collection.
- One AnythingLLM workspace represents the Twitch channel's shared memory.
- The Bot uses a stable channel-scoped API `sessionId` so AI conversation history survives Bot process restarts.
- Normal Twitch comments are ingested asynchronously and do not invoke answer generation.
- Ingestion records retain a stable event identifier, channel, source user, source display name, source timestamp, stream identifier when available, and original comment body. These fields are encoded in each transcript line because AnythingLLM's upload metadata is document-scoped.
- Incoming comments are buffered into chronological transcript batches before document embedding. Retries use stable identifiers and must not create duplicate documents or chunks.
- Before an AI request is sent to AnythingLLM, pending earlier comments are force-flushed within a bounded deadline. If embedding cannot complete within that deadline, the still-pending chronological comments are attached to that request as untrusted temporary context and remain queued for durable ingestion.
- A small local operational ledger tracks accepted message sequence, delivery state, stable event IDs, batch ID, content hash, AnythingLLM document path, workspace embedding state, retention deadline, chronological topic cursor, and retries. It is not the semantic answer-memory source of truth. Raw payload is retained only as required for retry, deterministic subject resolution, and the agreed 365-day retention.
- Comment bodies are stored unconditionally, but retrieved content is always marked as untrusted conversation evidence and cannot override system instructions.
- `!chat` and Bot mentions use the AnythingLLM workspace chat API. The workspace's LLM provider is Ollama.
- The Bot continues to own Twitch authentication, command dispatch, cooldowns, queueing, fixed replies, final 500-character formatting, emotes, and the send boundary.
- The integration preserves the existing output contracts for original-song replies, English repair, fixed safety replies, and no-command-execution behavior.
- Research intent is detected deterministically by the Bot. The Bot resolves omitted subjects from the restart-safe chronological topic cursor, calls the existing SearXNG adapter, preserves `found / no_result / failed`, and passes successful search evidence to AnythingLLM as untrusted context before AnythingLLM calls Ollama. LLM tool choice is not the correctness gate for explicit research requests.
- The chronological topic cursor advances by accepted message sequence and distinguishes the latest AI conversation topic from unrelated viewer interjections. It survives Bot restart and provides a deterministic subject for bare follow-ups such as「調べて」.
- AnythingLLM API use is isolated behind an adapter with explicit outcomes for success, no result, timeout, unavailable, invalid response, and rejected request.
- Transient ingestion failures enter a restart-safe durable spool and retry asynchronously. Chat reception and fixed commands do not wait for ingestion. Queue high-water and disk-pressure conditions fail loudly and never discard an accepted comment silently.
- Raw transcript documents never cross a stream boundary or JST date boundary and cover at most 15 minutes or 200 comments. Their expiry is the newest included comment timestamp plus 365 days. Cleanup is idempotent and removes the workspace reference, source document, vector data, and local ledger payload while retaining non-sensitive audit state.
- A stream summary is produced only after stream end and after the final ingestion watermark is confirmed. Long streams use deterministic hierarchical summaries. The final summary is keyed by stream ID, stored as a non-expiring document, and retry replaces or reuses the same logical summary instead of creating a duplicate.
- Summary generation uses a stream-specific API session so that maintenance prompts do not pollute the channel's conversational session.
- Durable facts are extracted per stream into non-expiring, source-attributed RAG documents keyed by stream ID. Conflicting facts remain attributed and time-ordered rather than one silently overwriting another. The limited AnythingLLM Memories & Personalization bank is not the primary fact store.
- Existing active SQLite facts and non-duplicate Mem0 memories are imported with migration provenance. Candidate, inactive, tombstoned, unsafe, or duplicate records are not promoted during migration.
- Migration uses an expand-and-contract rollout: deploy AnythingLLM, shadow-write, validate retrieval and performance, switch AI reads/generation, then remove SQLite/Mem0 integrations and finally their services.
- Until the cutover gate passes, a configuration switch can return to the existing AI conversation path without rolling back unrelated Bot features.
- During migration only, rollback may use the existing direct-Ollama path. After final cutover, main generation, English repair, song repair, stream summarization, and fact extraction all call Ollama through AnythingLLM. Utility generation uses a separate no-memory AnythingLLM workspace/session so maintenance prompts do not pollute channel memory.
- After final cutover, AnythingLLM unavailability returns the existing bounded AI failure reply and does not silently bypass AnythingLLM. Fixed commands and non-AI features continue normally.
- AnythingLLM image tags and digests are pinned. Telemetry and production Swagger exposure are disabled.
- The integration uses only versioned Developer API endpoints under `/api/v1`. The pinned instance's `/api/docs` is captured by contract tests before production Swagger exposure is disabled.
- Document retention deletion first removes embeddings from the workspace and then removes the source document from AnythingLLM storage.
- API credentials are provided only as runtime secrets or protected environment values and are never logged or committed.
- Console diagnostics include request IDs, counts, durations, selected path, queue depth, and failure reason but no comment, memory, prompt, result, or credential bodies.
- Administrative data removal is performed through the AnythingLLM management surface; no viewer-facing memory commands are added.

## Testing Decisions

- The primary behavioral seam is the Bot's public command/message boundary. Tests drive real normal comments, `!chat`, and Bot mentions through the dispatcher while mocking only the AnythingLLM HTTP boundary and Twitch send boundary.
- Primary tests assert observable behavior: whether ingestion was requested, whether a reply was sent, which high-level context source was used, whether an external search was attempted, and whether behavior survives a new Bot instance.
- Tests do not assert private helper implementation details, generated prompt wording beyond established output contracts, or vector database internals.
- Existing AI mention-chat, search, fixed-reply, song, logger, periodic task, and configuration tests are extended rather than replaced.
- A pinned AnythingLLM Docker instance is exercised by API contract tests covering health, authentication, workspace setup, document ingestion, embedding, retrieval/chat, thread identity, deletion, and invalid responses.
- Retention tests use a controlled clock and verify the 365-day boundary, summary non-expiry, idempotent deletion, and restart-safe cleanup.
- Ingestion tests cover ordering, batching, stable IDs, upload-success/response-loss reconciliation, duplicates, reconnect replay, durable spool behavior, disk-pressure alarms, timeout, retry, and malformed API responses.
- Freshness tests verify that a comment immediately preceding `!chat` is available either through completed embedding or bounded temporary context, without creating duplicate durable records.
- Retrieval tests cover direct questions, short follow-ups, process restart, comments from different viewers, named and unnamed speakers, contradicting comments, stale comments, and no relevant result.
- Topic-resolution tests cover Bot restart, a direct short answer, an intervening comment from another viewer, a normal-comment topic, and bare「調べて」without relying on semantic search for the omitted subject.
- Explicit-search tests assert one real SearXNG request with the resolved subject and separately assert `found`, `no_result`, and `failed` behavior before the AnythingLLM generation request.
- Security tests verify that prompt injection stored in a comment is quoted as evidence and cannot change system behavior.
- Failure tests verify AnythingLLM timeout/unavailability, Ollama failure behind AnythingLLM, vector search failure, and recovery without duplicate writes.
- Generation-path tests verify that main replies, English repair, song repair, summaries, and fact extraction never call Ollama directly after cutover.
- Performance tests measure ingestion throughput, queue lag, chat p50/p95, cold/warm Ollama behavior, embedding load, GPU residency, RAM, disk growth, and impact on existing SUB AI Services.
- Production verification uses no-send/no-write probes first, then a controlled shadow-write, then a real read/generation cutover with fresh logs and restart monitoring.

## Out of Scope

- Replacing Twitch authentication, fixed commands, Raid greetings, Clip handling, Discord notifications, stream detection, or other non-AI Bot features.
- Using AnythingLLM Cloud, hosted Mem0, hosted embeddings, or a paid LLM provider.
- Adding viewer-facing `!forgetme`, `!memoryoff`, or `!memoryon` commands.
- Restricting recall to the current viewer or separating one workspace per viewer.
- Importing historical Twitch comments that no longer exist in current local data.
- Changing the existing Ollama generation model solely as part of this migration.
- Publishing AnythingLLM directly to the Internet.

## Further Notes

- Production truth is the running sub-PC services, their effective configuration, persisted data, and fresh post-deploy probes.
- The current production snapshot already contains SQLite and Mem0 records, and both Mem0 semantic search and explicit SearXNG search respond successfully. The migration addresses retrieval and persistence boundaries rather than treating the existing stores as empty.
- The final AnythingLLM version, exact endpoint payloads, and Qdrant configuration are verified against the pinned instance's `/api/docs` and official source before implementation.
- The migration must not remove SQLite or Mem0 until migrated facts, retrieval quality, response latency, retention cleanup, restart behavior, and rollback have all passed their acceptance gates.
