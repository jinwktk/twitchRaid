import path from "node:path";

import { Config } from "../config";
import { AnythingLlmClient } from "../commands/anythingllm-client";
import { migrateLegacyMemoryToAnythingLlm } from "../commands/anythingllm-legacy-migration";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const config = new Config();
  if (!config.chatAiMem0Endpoint) {
    throw new Error("CHAT_AI_MEM0_ENDPOINT is required");
  }
  const client = new AnythingLlmClient({
    baseUrl: config.anythingLlmBaseUrl,
    apiKeyFile: config.anythingLlmApiKeyFile,
    workspaceName: config.anythingLlmWorkspaceName,
    workspaceSlug: config.anythingLlmWorkspaceSlug,
    sessionId: config.anythingLlmSessionId,
    timeoutMs: config.anythingLlmTimeoutMs,
  });
  const result = await migrateLegacyMemoryToAnythingLlm({
    sourceSqlitePath: config.chatAiMemoryDbPath,
    migrationSqlitePath: path.resolve(
      process.env["ANYTHING_LLM_LEGACY_MIGRATION_DB_PATH"] ??
        "data/anythingllm-legacy-migration.sqlite"
    ),
    anythingLlmClient: client,
    mem0Endpoint: config.chatAiMem0Endpoint,
    mem0ApiKey: config.chatAiMem0ApiKey,
    mem0UserId: config.chatAiMem0UserId,
    mem0AgentId: config.chatAiMem0AgentId,
    mem0AppId: config.chatAiMem0AppId,
    mem0Limit: positiveInteger(
      process.env["ANYTHING_LLM_LEGACY_MIGRATION_MEM0_LIMIT"],
      10_000
    ),
    mem0TimeoutMs: config.chatAiMem0TimeoutMs,
  });
  process.stdout.write(
    `AnythingLLM legacy migration ${result.status}: entries=${result.entryCount} snapshot=${result.snapshotSha256}\n`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`AnythingLLM legacy migration failed: ${message}\n`);
  process.exitCode = 1;
});
