import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "..");
const keepaliveScriptPath = path.join(
  repoRoot,
  "ops/sub-ai-services/keep-wsl-dokploy-alive.ps1"
);
const windowsIt = process.platform === "win32" ? it : it.skip;

interface PortProxyRecoveryFixtureResult {
  Result: Record<string, unknown>;
  RestartCount: number;
  StartCount: number;
  SleepCount: number;
  ListenerChecks: number;
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShellFixture<T>(fixture: string): T {
  const scriptPathLiteral = toPowerShellLiteral(keepaliveScriptPath);
  const command = `
$ErrorActionPreference = "Stop"
$scriptPath = ${scriptPathLiteral}
$source = Get-Content -Raw -LiteralPath $scriptPath
if ($source -notmatch '(?im)^\\s*function\\s+Invoke-PortProxyListenerRecovery\\b') {
    [Console]::Error.WriteLine("Invoke-PortProxyListenerRecovery is not implemented")
    exit 41
}
. $scriptPath
if (-not (Get-Command Invoke-PortProxyListenerRecovery -ErrorAction SilentlyContinue)) {
    [Console]::Error.WriteLine("Invoke-PortProxyListenerRecovery was not exported by dot-sourcing")
    exit 42
}
${fixture}
`;
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  const execution = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    }
  );

  if (execution.error || execution.status !== 0) {
    throw new Error(
      [
        `PowerShell fixture failed with status ${execution.status ?? "none"}`,
        execution.error?.message ?? "",
        execution.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return JSON.parse(execution.stdout.trim()) as T;
}

function runPortProxyRecoveryFixture(options: {
  managedPorts: number[];
  mappingPorts: number[];
  listenerProviderBody: string;
  serviceStatus?: "Running" | "Stopped";
  restartThrows?: boolean;
}): PortProxyRecoveryFixtureResult {
  const mappingRows = options.mappingPorts
    .map(
      (port) =>
        `[pscustomobject]@{ ListenAddress = "192.168.0.99"; ListenPort = ${port} }`
    )
    .join("\n        ");
  const managedPorts = options.managedPorts.join(", ");
  const restartFailure = options.restartThrows
    ? 'throw "restart failed"'
    : "";

  return runPowerShellFixture<PortProxyRecoveryFixtureResult>(`
$script:restartCount = 0
$script:startCount = 0
$script:sleepCount = 0
$script:listenerChecks = 0
$script:logs = @()
$mappingProvider = {
    @(
        ${mappingRows}
    )
}
$listenerProvider = {
    ${options.listenerProviderBody}
}
$serviceStatusProvider = { "${options.serviceStatus ?? "Running"}" }
$restartIpHelper = {
    $script:restartCount += 1
    ${restartFailure}
}
$startIpHelper = { $script:startCount += 1 }
$sleepAction = {
    param($Seconds)
    $script:sleepCount += 1
}
$logAction = {
    param($Message)
    $script:logs += [string]$Message
}
$arguments = @{
    LanAddress = "192.168.0.99"
    ManagedPorts = @(${managedPorts})
    MappingProvider = $mappingProvider
    ListenerProvider = $listenerProvider
    ServiceStatusProvider = $serviceStatusProvider
    RestartIpHelper = $restartIpHelper
    StartIpHelper = $startIpHelper
    SleepAction = $sleepAction
    LogAction = $logAction
}
$result = Invoke-PortProxyListenerRecovery @arguments
[pscustomobject]@{
    Result = $result
    RestartCount = $script:restartCount
    StartCount = $script:startCount
    SleepCount = $script:sleepCount
    ListenerChecks = $script:listenerChecks
} | ConvertTo-Json -Depth 8 -Compress
`);
}

function expectRecoveryResultShape(result: Record<string, unknown>): void {
  expect(Object.keys(result)).toEqual(
    expect.arrayContaining([
      "Status",
      "ConfiguredPorts",
      "MissingPorts",
      "Action",
    ])
  );
  expect(result.ConfiguredPorts).toEqual(expect.any(Array));
  expect(result.MissingPorts).toEqual(expect.any(Array));
}

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
    expect(compose).not.toContain("localhost:5050/twitchraid-mem0-oss:local");
    expect(compose).toContain(
      "/home/mlove/dokploy/searxng/settings.yml:/etc/searxng/settings.yml:ro"
    );
    expect(compose).toContain(
      "/home/mlove/dokploy/mem0/qdrant:/qdrant/storage"
    );
    expect(compose).not.toContain("/home/mlove/dokploy/mem0/history:/app/history");
    expect(compose).toContain("QDRANT__TELEMETRY_DISABLED: \"true\"");
    expect(compose).not.toContain("MEM0_OLLAMA_BASE_URL");
    expect(compose).not.toContain("MEM0_LLM_MODEL");
    expect(compose).not.toContain("MEM0_EMBEDDER_MODEL");
    expect(compose).not.toContain("MEM0_INFER_DEFAULT");
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
    expect(compose).not.toContain("- mem0");
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
    expect(settings).toContain("- bing");
    expect(settings).toContain("- yahoo japan");
    expect(settings).not.toContain("- google");
    expect(settings).not.toContain("- duckduckgo");
    expect(settings).toContain("- name: yahoo japan");
    expect(settings).toContain("engine: xpath");
    expect(settings).toContain(
      "search_url: https://search.yahoo.co.jp/search?p={query}"
    );
    expect(settings).toContain(
      'results_xpath: \'//div[contains(concat(" ", normalize-space(@class), " "), " Algo ")]\''
    );
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
    const recoveryIndex = script.indexOf(
      "Invoke-PortProxyListenerRecovery",
      refreshIndex
    );
    const wslIndex = script.indexOf("& wsl.exe", catchIndex);

    expect(writeLogTryIndex).toBeGreaterThan(writeLogIndex);
    expect(addContentIndex).toBeGreaterThan(writeLogTryIndex);
    expect(writeLogCatchIndex).toBeGreaterThan(addContentIndex);
    expect(keepaliveIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(keepaliveIndex);
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(catchIndex).toBeGreaterThan(refreshIndex);
    expect(recoveryIndex).toBeGreaterThan(refreshIndex);
    expect(recoveryIndex).toBeLessThan(wslIndex);
    expect(wslIndex).toBeGreaterThan(catchIndex);
    expect(script.slice(refreshIndex, catchIndex)).not.toContain("Out-String");
    expect(script.slice(refreshIndex, catchIndex)).not.toContain("Add-Content");
    expect(script).toContain("continuing WSL keepalive");
    expect(script).toContain(
      "systemctl start docker && systemctl is-active --quiet docker && sleep $PortProxyHealthIntervalSeconds"
    );
    expect(script).not.toContain("while true; do sleep 3600; done");
    expect(script).toContain("$refreshRequired = $false");
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
      '$RefreshScript = Join-Path $PSScriptRoot "refresh-wsl-dokploy-portproxy.ps1"'
    );

    expect(paramEndIndex).toBeGreaterThan(-1);
    expect(script.slice(0, paramEndIndex)).not.toContain("$PSScriptRoot");
    expect(refreshResolutionIndex).toBeGreaterThan(paramEndIndex);
  });

  it("tracks the boot-time portproxy refresh for the LAN-only Web UIs", () => {
    const refreshPath = path.join(
      repoRoot,
      "ops/sub-ai-services/refresh-wsl-dokploy-portproxy.ps1"
    );

    expect(fs.existsSync(refreshPath)).toBe(true);
    const refresh = fs.readFileSync(refreshPath, "utf8");

    expect(refresh).toContain("$LanUiPorts = @(3220, 3221)");
    expect(refresh).toContain('$LanAddress = "192.168.0.99"');
    expect(refresh).toContain('$LanSubnet = "192.168.0.0/24"');
    expect(refresh).toContain("foreach ($Port in $LanUiPorts)");
    expect(refresh).toContain(
      "listenaddress=0.0.0.0 listenport=$Port"
    );
    expect(refresh).toContain(
      "listenaddress=$LanAddress listenport=$Port connectaddress=$WslIp connectport=$Port"
    );
    expect(refresh).not.toContain('$ListenAddress = "0.0.0.0"');
    expect(refresh.match(/-LocalAddress \$LanAddress/gu)).toHaveLength(2);
    expect(refresh.match(/-RemoteAddress \$LanSubnet/gu)).toHaveLength(2);
  });

  describe("Windows portproxy listener recovery", () => {
    windowsIt("dot-sourceしても無限ループを開始せず回復関数を公開する", () => {
      const output = runPowerShellFixture<{
        DotSourced: boolean;
        FunctionAvailable: boolean;
      }>(`
[pscustomobject]@{
    DotSourced = $true
    FunctionAvailable = [bool](Get-Command Invoke-PortProxyListenerRecovery -ErrorAction SilentlyContinue)
} | ConvertTo-Json -Compress
`);

      expect(output).toEqual({
        DotSourced: true,
        FunctionAvailable: true,
      });
    });

    windowsIt(
      "mappingがありlistenerが欠落していればIP Helperを1回だけ再起動して回復する",
      () => {
        const output = runPortProxyRecoveryFixture({
          managedPorts: [3220],
          mappingPorts: [3220],
          listenerProviderBody: `
$script:listenerChecks += 1
if ($script:listenerChecks -ge 2) {
    @([pscustomobject]@{ LocalAddress = "192.168.0.99"; LocalPort = 3220; State = "Listen" })
}
`,
        });

        expectRecoveryResultShape(output.Result);
        expect(output.Result.Status).toBe("recovered");
        expect(output.Result.ConfiguredPorts).toEqual([3220]);
        expect(output.RestartCount).toBe(1);
        expect(output.StartCount).toBe(0);
        expect(output.SleepCount).toBe(1);
      }
    );

    windowsIt("listenerが既にあればservice操作を行わない", () => {
      const output = runPortProxyRecoveryFixture({
        managedPorts: [3220],
        mappingPorts: [3220],
        listenerProviderBody: `
$script:listenerChecks += 1
@([pscustomobject]@{ LocalAddress = "192.168.0.99"; LocalPort = 3220; State = "Listen" })
`,
      });

      expectRecoveryResultShape(output.Result);
      expect(output.RestartCount).toBe(0);
      expect(output.StartCount).toBe(0);
      expect(output.SleepCount).toBe(0);
    });

    windowsIt("mappingが無ければservice操作を行わない", () => {
      const output = runPortProxyRecoveryFixture({
        managedPorts: [3220],
        mappingPorts: [],
        listenerProviderBody: "$script:listenerChecks += 1",
      });

      expectRecoveryResultShape(output.Result);
      expect(output.Result.ConfiguredPorts).toEqual([]);
      expect(output.RestartCount).toBe(0);
      expect(output.StartCount).toBe(0);
      expect(output.SleepCount).toBe(0);
    });

    windowsIt("複数portのlistenerが欠落してもIP Helperの再起動は合計1回にする", () => {
      const output = runPortProxyRecoveryFixture({
        managedPorts: [3220, 3221],
        mappingPorts: [3220, 3221],
        listenerProviderBody: `
$script:listenerChecks += 1
if ($script:listenerChecks -ge 2) {
    @(
        [pscustomobject]@{ LocalAddress = "192.168.0.99"; LocalPort = 3220; State = "Listen" }
        [pscustomobject]@{ LocalAddress = "192.168.0.99"; LocalPort = 3221; State = "Listen" }
    )
}
`,
      });

      expectRecoveryResultShape(output.Result);
      expect(output.Result.Status).toBe("recovered");
      expect(output.Result.ConfiguredPorts).toEqual([3220, 3221]);
      expect(output.RestartCount).toBe(1);
      expect(output.StartCount).toBe(0);
      expect(output.SleepCount).toBe(1);
    });

    windowsIt("IP Helperが停止中なら再起動せず1回だけ開始する", () => {
      const output = runPortProxyRecoveryFixture({
        managedPorts: [3220],
        mappingPorts: [3220],
        serviceStatus: "Stopped",
        listenerProviderBody: `
$script:listenerChecks += 1
if ($script:listenerChecks -ge 2) {
    @([pscustomobject]@{ LocalAddress = "192.168.0.99"; LocalPort = 3220; State = "Listen" })
}
`,
      });

      expectRecoveryResultShape(output.Result);
      expect(output.Result.Status).toBe("recovered");
      expect(output.RestartCount).toBe(0);
      expect(output.StartCount).toBe(1);
      expect(output.SleepCount).toBe(1);
    });

    windowsIt("IP Helperの再起動例外をthrowせずfailed結果として返す", () => {
      const output = runPortProxyRecoveryFixture({
        managedPorts: [3220],
        mappingPorts: [3220],
        restartThrows: true,
        listenerProviderBody: "$script:listenerChecks += 1",
      });

      expectRecoveryResultShape(output.Result);
      expect(output.Result.Status).toBe("failed");
      expect(output.RestartCount).toBe(1);
      expect(output.StartCount).toBe(0);
    });
  });

  it("benchmarks SearXNG with reverse-proxy client headers", () => {
    const benchmark = fs.readFileSync(
      path.join(repoRoot, "scripts/benchmark-sub-ai-services-remote.sh"),
      "utf8"
    );

    expect(benchmark).toContain('"X-Forwarded-For": "127.0.0.1"');
    expect(benchmark).toContain('"X-Real-IP": "127.0.0.1"');
    expect(benchmark).toContain(
      'process.env.CHAT_AI_MODEL || "gemma4:e4b-it-qat"'
    );
    expect(benchmark).toContain(
      '["CHAT_AI_MODEL", "gemma4:e4b-it-qat"]'
    );
    expect(benchmark).toContain(
      '["OLLAMA_MODEL", "gemma4:e4b-it-qat"]'
    );
    expect(benchmark).toContain(
      '["OLLAMA_SHOUTOUT_MODEL", "gemma4:e4b-it-qat"]'
    );
    expect(benchmark).toContain("anythingllm");
    expect(benchmark).toContain('["CHAT_AI_ANYTHINGLLM_ENABLED", "true"]');
    expect(benchmark).toContain('["ANYTHING_LLM_BASE_URL", anythingLlmBaseUrl]');
    expect(benchmark).toContain(
      '["CHAT_AI_SEARCH_ENGINES", "yahoo japan,bing"]'
    );
    expect(benchmark).not.toContain(
      '["CHAT_AI_SEARCH_ENGINES", "bing"]'
    );
    expect(benchmark).toContain(
      'searxngUrl.searchParams.set("engines", "yahoo japan,bing")'
    );
    expect(benchmark).not.toContain("sub-ai_mem0");
    expect(benchmark).not.toContain("CHAT_AI_MEM0_");
  });

  it("keeps the SUB AI performance gate aligned with the Gemma production baseline", () => {
    const benchmark = fs.readFileSync(
      path.join(repoRoot, "scripts/benchmark-sub-ai-services.mjs"),
      "utf8"
    );

    expect(benchmark).toContain("generate: 770.54");
    expect(benchmark).toContain("embed: 32.49");
    expect(benchmark).toContain("anythingllm: 100");
    expect(benchmark).toContain("searxng: 631.25");
    expect(benchmark).toContain(
      "refresh-wsl-dokploy-portproxy.ps1"
    );
    expect(benchmark).toContain("expectedRefreshHash");
    expect(benchmark).toContain(
      "keepaliveTask.refreshFileHash !== expectedRefreshHash"
    );
    expect(benchmark).toContain(
      "deployed SUB AI portproxy refresh script does not match the repository"
    );
    expect(benchmark).toContain(
      "portproxyRefreshScriptHashMatches: true"
    );
  });

  it("uses the production WSL distribution for the LAN-only AnythingLLM UI", () => {
    const script = fs.readFileSync(
      path.join(repoRoot, "scripts/configure-anythingllm-lan-ui.ps1"),
      "utf8"
    );

    expect(script).toContain('[string]$WslDistribution = "Ubuntu-Backup"');
    expect(script).toContain('-RemoteAddress $LanSubnet');
    expect(script).toContain('listenaddress=0.0.0.0 listenport=$Port');
    expect(script).toContain('listenaddress=$LanAddress');
  });
});
