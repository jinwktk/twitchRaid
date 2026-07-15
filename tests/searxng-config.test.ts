import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");

describe("SearXNG self-hosting config", () => {
  it("keeps SearXNG inside the SUB AI Services Docker Compose stack", () => {
    const compose = fs.readFileSync(
      path.join(repoRoot, "ops/sub-ai-services/docker-compose.yml"),
      "utf8"
    );

    expect(compose).toContain("ollama/ollama:latest");
    expect(compose).toContain("localhost:5050/sub-whisper-api:local");
    expect(compose).toContain("localhost:5050/sub-sbvits2:local");
    expect(compose).toContain("searxng/searxng:latest");
    expect(compose).toContain("qdrant/qdrant:v1.15.4");
    expect(compose).toContain("localhost:5050/twitchraid-mem0-oss:local");
    expect(compose).toContain(
      "/home/mlove/dokploy/searxng/settings.yml:/etc/searxng/settings.yml:ro"
    );
    expect(compose).toContain(
      "/home/mlove/dokploy/mem0/qdrant:/qdrant/storage"
    );
    expect(compose).toContain(
      "/home/mlove/dokploy/mem0/history:/app/history"
    );
    expect(compose).toContain("QDRANT__TELEMETRY_DISABLED: \"true\"");
    expect(compose).toContain("MEM0_OLLAMA_BASE_URL: http://sub-ai_ollama:11434");
    expect(compose).toContain("MEM0_EMBEDDER_MODEL: nomic-embed-text:latest");
    expect(compose).toContain("MEM0_INFER_DEFAULT: \"false\"");
    expect(compose).toContain("OLLAMA_KEEP_ALIVE: 30m");
    expect(compose).toContain('OLLAMA_NUM_PARALLEL: "1"');
    expect(compose).toContain('OLLAMA_CONTEXT_LENGTH: "4096"');
    expect(compose).toContain('OLLAMA_MAX_LOADED_MODELS: "2"');
    expect(compose).toContain('OLLAMA_FLASH_ATTENTION: "1"');
    expect(compose).toContain(
      "/home/mlove/dokploy/ollama:/root/.ollama"
    );
    expect(compose).toContain(
      "/home/mlove/dokploy/huggingface:/root/.cache/huggingface"
    );
    expect(compose).not.toContain("/mnt/c/Users/mlove/.ollama");
    expect(compose).not.toContain("/mnt/c/Users/mlove/.cache/huggingface");
    expect(compose).toContain("aliases:");
    expect(compose).toContain("- searxng");
    expect(compose).toContain("- mem0");
    expect(compose).toContain("- qdrant");
    expect(compose).toContain("restart_policy:");
    expect(compose).not.toContain("published: 8080");
    expect(compose).not.toContain("target: 8888");
    expect(compose).not.toContain("target: 6333");
  });

  it("does not keep a standalone SearXNG compose stack", () => {
    expect(
      fs.existsSync(path.join(repoRoot, "ops/searxng/docker-compose.yml"))
    ).toBe(false);
  });

  it("enables JSON output and keeps multiple search engines available", () => {
    const settings = fs.readFileSync(
      path.join(repoRoot, "ops/searxng/settings.yml"),
      "utf8"
    );

    expect(settings).toContain("formats:");
    expect(settings).toContain("- json");
    expect(settings).toContain("keep_only:");
    expect(settings).toContain("- google");
    expect(settings).toContain("- duckduckgo");
    expect(settings).toContain("- bing");
    expect(settings).toContain("disabled: false");
    expect(settings).toContain("keepalive_expiry: 300.0");
  });

  it("keeps WSL and Docker alive even when portproxy refresh fails", () => {
    const scriptPath = path.join(
      repoRoot,
      "ops/sub-ai-services/keep-wsl-dokploy-alive.ps1"
    );

    expect(fs.existsSync(scriptPath)).toBe(true);

    const script = fs.readFileSync(scriptPath, "utf8");
    const writeLogIndex = script.indexOf("function Write-Log");
    const writeLogTryIndex = script.indexOf("try", writeLogIndex);
    const addContentIndex = script.indexOf("Add-Content", writeLogIndex);
    const writeLogCatchIndex = script.indexOf("catch", addContentIndex);
    const keepaliveIndex = script.indexOf("while ($true)");
    const refreshIndex = script.indexOf("& $RefreshScript");
    const catchIndex = script.indexOf("catch", refreshIndex);
    const wslIndex = script.indexOf("& wsl.exe", catchIndex);

    expect(writeLogTryIndex).toBeGreaterThan(writeLogIndex);
    expect(addContentIndex).toBeGreaterThan(writeLogTryIndex);
    expect(writeLogCatchIndex).toBeGreaterThan(addContentIndex);
    expect(keepaliveIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(keepaliveIndex);
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(catchIndex).toBeGreaterThan(refreshIndex);
    expect(wslIndex).toBeGreaterThan(catchIndex);
    expect(script).toContain("continuing WSL keepalive");
    expect(script).toContain(
      "systemctl start docker && systemctl is-active --quiet docker && while true; do sleep 3600; done"
    );
    expect(script).toContain("Start-Sleep -Seconds $RestartDelaySeconds");
  });

  it("resolves the default refresh script after PowerShell initializes PSScriptRoot", () => {
    const script = fs
      .readFileSync(
        path.join(
          repoRoot,
          "ops/sub-ai-services/keep-wsl-dokploy-alive.ps1"
        ),
        "utf8"
      )
      .replace(/\r\n?/gu, "\n");
    const paramEndIndex = script.indexOf("\n)\n");
    const refreshResolutionIndex = script.indexOf(
      '$RefreshScript = Join-Path $PSScriptRoot "refresh_wsl_dokploy_portproxy.ps1"'
    );

    expect(paramEndIndex).toBeGreaterThan(-1);
    expect(script.slice(0, paramEndIndex)).not.toContain("$PSScriptRoot");
    expect(refreshResolutionIndex).toBeGreaterThan(paramEndIndex);
  });

  it("benchmarks SearXNG with reverse-proxy client headers", () => {
    const benchmark = fs.readFileSync(
      path.join(repoRoot, "scripts/benchmark-sub-ai-services-remote.sh"),
      "utf8"
    );

    expect(benchmark).toContain('"X-Forwarded-For": "127.0.0.1"');
    expect(benchmark).toContain('"X-Real-IP": "127.0.0.1"');
  });
});
