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

interface WslMountRecoveryFixtureResult {
  Result: Record<string, unknown>;
  PersistCount: number;
  TerminateCount: number;
  SleepCount: number;
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

function runBashFixture(script: string): number | null {
  const execution = spawnSync("bash", ["-lc", script], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (execution.error) {
    throw execution.error;
  }
  return execution.status;
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
      "& wsl.exe -d $Distribution -u root -- bash -lc $wslKeepaliveLaunchCommand"
    );
    expect(script).not.toContain("while true; do sleep 3600; done");
    expect(script).toContain("$refreshRequired = $false");
    expect(script).toContain("-RestartDelaySeconds $RestartDelaySeconds");
    expect(script).toContain(
      "Start-Sleep -Seconds $transition.RetryDelaySeconds"
    );
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

  it("mount namespace不整合だけを連続回数とcooldown付きで自動復旧する", () => {
    const script = fs
      .readFileSync(keepaliveScriptPath, "utf8")
      .replace(/\r\n?/gu, "\n");
    const startIndex = script.indexOf("function Start-WslDokployKeepalive");
    const startFunction = script.slice(startIndex);

    expect(script).toContain(
      '[string]$CriticalWslMountPath = "/mnt/e/GitHub/RukalunPage"'
    );
    expect(script).toContain(
      '[string]$MountRecoveryStateFile = "E:\\GitHub\\BotManager\\logs\\dokploy-wsl-mount-recovery-state.json"'
    );
    expect(startFunction).toContain("New-WslDockerKeepaliveCommand");
    expect(startFunction).toContain("ConvertTo-WslEncodedBashCommand");
    expect(startFunction).toContain("Get-WslKeepaliveLoopTransition");
    expect(startFunction).toContain(
      "Get-WslMountRecoveryAttempt -StateFile $MountRecoveryStateFile"
    );
    expect(startFunction).toContain("$exitCode -eq 86");
    expect(startFunction).toContain("$exitCode -eq 87");
    expect(startFunction).toContain("$exitCode -eq 88");
    expect(startFunction).toContain("$staleMountFailureCount += 1");
    expect(startFunction).toContain("Invoke-WslMountNamespaceRecovery");
    expect(startFunction).toContain("-LastRecoveryAt $lastMountRecoveryAt");
    expect(startFunction).toContain("-RecoveryCooldownSeconds $MountRecoveryCooldownSeconds");
    expect(script).toContain(
      "Set-WslMountRecoveryAttempt -StateFile $MountRecoveryStateFile"
    );
    expect(startFunction).toContain("-RecoveryStatus $recovery.Status");
    expect(startFunction).toContain("$mountRecoveryAwaitingConfirmation");
    expect(startFunction).toContain(
      "WSL mount namespace recovery result=success"
    );
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

  describe("Windows WSL mount namespace recovery", () => {
    windowsIt("復旧試行時刻をWindows側stateへ永続化して再読込できる", () => {
      const output = runPowerShellFixture<{
        LoadedAttemptAt: string;
      }>(`
$stateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("twitchraid-wsl-recovery-" + [Guid]::NewGuid().ToString("N"))
$stateFile = Join-Path $stateDirectory "state.json"
try {
    Set-WslMountRecoveryAttempt \
        -StateFile $stateFile \
        -Distribution "Ubuntu-Backup" \
        -AttemptAt ([DateTimeOffset]::Parse("2026-08-26T16:00:00+09:00"))
    $loaded = Get-WslMountRecoveryAttempt -StateFile $stateFile
    [pscustomobject]@{
        LoadedAttemptAt = $loaded.ToString("o")
    } | ConvertTo-Json -Compress
}
finally {
    if (Test-Path -LiteralPath $stateDirectory) {
        Remove-Item -LiteralPath $stateDirectory -Recurse -Force
    }
}
`);

      expect(output.LoadedAttemptAt).toBe("2026-08-26T16:00:00.0000000+09:00");
    });

    windowsIt(
      "通常shellとPID 1のmount状態を別々のexit codeで判定する",
      () => {
        const output = runPowerShellFixture<{ Command: string }>(`
$command = New-WslDockerKeepaliveCommand \
    -CriticalMountPath "/mnt/e/GitHub/RukalunPage" \
    -HealthIntervalSeconds 60
[pscustomobject]@{ Command = $command } | ConvertTo-Json -Compress
`);

        expect(output.Command).toBe(
          "systemctl start docker && systemctl is-active --quiet docker || exit 1; " +
            "stat -- '/mnt/e/GitHub/RukalunPage' >/dev/null 2>&1 || exit 87; " +
            "pid1_mount_error=\"$(nsenter -t 1 -m -- sh -c 'pid1_stat_error=\"$(LC_ALL=C stat -- \"$1\" 2>&1)\" || " +
            "{ printf \"__PID1_STAT_ERROR__%s\" \"$pid1_stat_error\"; exit 86; }' sh '/mnt/e/GitHub/RukalunPage' 2>&1)\"; " +
            "pid1_mount_exit=$?; if [ \"$pid1_mount_exit\" -ne 0 ]; then " +
            "case \"$pid1_mount_error\" in __PID1_STAT_ERROR__stat:*\": Invalid argument\") exit 86 ;; " +
            "*) exit 88 ;; esac; fi; " +
            "sleep 60"
        );
      }
    );

    windowsIt("base64 wrapperが入れ子quoteとexit codeを保持してdecode失敗を拒否する", () => {
      const output = runPowerShellFixture<{
        Launch86: string;
        Launch87: string;
        Launch88: string;
      }>(`
[pscustomobject]@{
    Launch86 = ConvertTo-WslEncodedBashCommand -Command 'printf "nested=%s" "Invalid argument"; exit 86'
    Launch87 = ConvertTo-WslEncodedBashCommand -Command 'exit 87'
    Launch88 = ConvertTo-WslEncodedBashCommand -Command 'exit 88'
} | ConvertTo-Json -Compress
`);

      expect(output.Launch86).toMatch(
        /^command -v base64 >\/dev\/null 2>&1 \|\| exit 89; set -o pipefail; printf %s [A-Za-z0-9+/=]+ \| base64 -d \| bash$/u
      );
      expect(runBashFixture(output.Launch86)).toBe(86);
      expect(runBashFixture(output.Launch87)).toBe(87);
      expect(runBashFixture(output.Launch88)).toBe(88);

      const invalidPayloadLaunch = output.Launch86.replace(
        /(printf %s )[A-Za-z0-9+/=]+/u,
        "$1%%%"
      );
      expect(runBashFixture(invalidPayloadLaunch)).not.toBe(0);
      expect(runBashFixture(`PATH=/nonexistent; ${output.Launch86}`)).toBe(89);
    });

    windowsIt(
      "nsenter自体のInvalid argumentをPID 1内stat不整合へ誤分類しない",
      () => {
        const output = runPowerShellFixture<{ Command: string }>(`
$command = New-WslDockerKeepaliveCommand \
    -CriticalMountPath "/mnt/e/GitHub/RukalunPage" \
    -HealthIntervalSeconds 60
[pscustomobject]@{ Command = $command } | ConvertTo-Json -Compress
`);
        const probeStart = output.Command.indexOf("pid1_mount_error=");
        const probeEnd = output.Command.lastIndexOf("; sleep 60");
        expect(probeStart).toBeGreaterThan(-1);
        expect(probeEnd).toBeGreaterThan(probeStart);
        const probe = output.Command.slice(probeStart, probeEnd);

        const nsenterFailureStatus = runBashFixture(`
nsenter() {
    printf '%s' 'nsenter: reassociate to namespace failed: Invalid argument' >&2
    return 1
}
${probe}
`);
        const innerStatFailureStatus = runBashFixture(`
nsenter() {
    printf '%s' '__PID1_STAT_ERROR__stat: cannot statx /mnt/e/GitHub/RukalunPage: Invalid argument' >&2
    return 86
}
${probe}
`);
        const otherProbeFailureStatus = runBashFixture(`
nsenter() {
    printf '%s' 'nsenter: cannot open /proc/1/ns/mnt: Permission denied' >&2
    return 1
}
${probe}
`);

        expect(nsenterFailureStatus).toBe(88);
        expect(innerStatFailureStatus).toBe(86);
        expect(otherProbeFailureStatus).toBe(88);
        expect(probe).toContain("LC_ALL=C stat");
      }
    );

    windowsIt(
      "復旧待機・再起動・失敗・未知probe・復旧確認のloop遷移を分離する",
      () => {
        const output = runPowerShellFixture<{
          Pending: Record<string, unknown>;
          Terminated: Record<string, unknown>;
          Failed: Record<string, unknown>;
          UnknownProbe: Record<string, unknown>;
          Confirmed: Record<string, unknown>;
        }>(`
$common = @{
    PortProxyHealthIntervalSeconds = 60
    RestartDelaySeconds = 5
}
$pending = Get-WslKeepaliveLoopTransition @common -ExitCode 86 -RecoveryStatus "pending"
$terminated = Get-WslKeepaliveLoopTransition @common -ExitCode 86 -RecoveryStatus "terminated"
$failed = Get-WslKeepaliveLoopTransition @common -ExitCode 86 -RecoveryStatus "failed"
$unknownProbe = Get-WslKeepaliveLoopTransition @common -ExitCode 88
$confirmed = Get-WslKeepaliveLoopTransition @common -ExitCode 0 -MountRecoveryAwaitingConfirmation $true
[pscustomobject]@{
    Pending = $pending
    Terminated = $terminated
    Failed = $failed
    UnknownProbe = $unknownProbe
    Confirmed = $confirmed
} | ConvertTo-Json -Depth 8 -Compress
`);

        expect(output.Pending).toMatchObject({
          RetryDelaySeconds: 60,
          ResetFailureCount: false,
          AwaitingConfirmation: false,
          ConfirmedRecovery: false,
          RememberRecoveryAttempt: false,
          FailureReason: "stale_mount",
        });
        expect(output.Terminated).toMatchObject({
          RetryDelaySeconds: 0,
          ResetFailureCount: true,
          AwaitingConfirmation: true,
          RememberRecoveryAttempt: true,
        });
        expect(output.Failed).toMatchObject({
          RetryDelaySeconds: 60,
          ResetFailureCount: true,
          AwaitingConfirmation: false,
          RememberRecoveryAttempt: true,
        });
        expect(output.UnknownProbe).toMatchObject({
          RetryDelaySeconds: 60,
          ResetFailureCount: true,
          FailureReason: "pid1_probe_failed",
        });
        expect(output.Confirmed).toMatchObject({
          RetryDelaySeconds: 0,
          ResetFailureCount: true,
          AwaitingConfirmation: false,
          ConfirmedRecovery: true,
          FailureReason: "healthy",
        });
      }
    );

    windowsIt(
      "mount namespace不整合が2回続けばdistributionを1回だけterminateする",
      () => {
        const output = runPowerShellFixture<WslMountRecoveryFixtureResult>(`
$script:terminateCount = 0
$script:persistCount = 0
$script:sleepCount = 0
$persistRecoveryAttempt = {
    param($DistributionName, $AttemptAt)
    $script:persistCount += 1
}
$terminateDistribution = {
    param($DistributionName)
    $script:terminateCount += 1
}
$sleepAction = {
    param($Seconds)
    $script:sleepCount += 1
}
$logAction = { param($Message) }
$result = Invoke-WslMountNamespaceRecovery \
    -Distribution "Ubuntu-Backup" \
    -ConsecutiveFailureCount 2 \
    -RequiredConsecutiveFailures 2 \
    -LastRecoveryAt $null \
    -RecoveryDelaySeconds 10 \
    -PersistRecoveryAttempt $persistRecoveryAttempt \
    -TerminateDistribution $terminateDistribution \
    -SleepAction $sleepAction \
    -LogAction $logAction
[pscustomobject]@{
    Result = $result
    PersistCount = $script:persistCount
    TerminateCount = $script:terminateCount
    SleepCount = $script:sleepCount
} | ConvertTo-Json -Depth 8 -Compress
`);

        expect(output.Result.Status).toBe("terminated");
        expect(output.Result.Action).toBe("terminate_distribution");
        expect(output.PersistCount).toBe(1);
        expect(output.TerminateCount).toBe(1);
        expect(output.SleepCount).toBe(1);
      }
    );

    windowsIt("前回復旧から15分以内ならdistributionを再terminateしない", () => {
      const output = runPowerShellFixture<WslMountRecoveryFixtureResult>(`
$script:terminateCount = 0
$script:persistCount = 0
$script:sleepCount = 0
$persistRecoveryAttempt = {
    param($DistributionName, $AttemptAt)
    $script:persistCount += 1
}
$terminateDistribution = {
    param($DistributionName)
    $script:terminateCount += 1
}
$sleepAction = {
    param($Seconds)
    $script:sleepCount += 1
}
$logAction = { param($Message) }
$result = Invoke-WslMountNamespaceRecovery \
    -Distribution "Ubuntu-Backup" \
    -ConsecutiveFailureCount 2 \
    -RequiredConsecutiveFailures 2 \
    -LastRecoveryAt ([DateTimeOffset]::Parse("2026-08-26T16:00:00+09:00")) \
    -Now ([DateTimeOffset]::Parse("2026-08-26T16:01:00+09:00")) \
    -RecoveryCooldownSeconds 900 \
    -RecoveryDelaySeconds 10 \
    -PersistRecoveryAttempt $persistRecoveryAttempt \
    -TerminateDistribution $terminateDistribution \
    -SleepAction $sleepAction \
    -LogAction $logAction
[pscustomobject]@{
    Result = $result
    PersistCount = $script:persistCount
    TerminateCount = $script:terminateCount
    SleepCount = $script:sleepCount
} | ConvertTo-Json -Depth 8 -Compress
`);

      expect(output.Result.Status).toBe("cooldown");
      expect(output.Result.Action).toBe("none");
      expect(output.PersistCount).toBe(0);
      expect(output.TerminateCount).toBe(0);
      expect(output.SleepCount).toBe(0);
    });

    windowsIt("復旧試行時刻を永続化できなければdistributionをterminateしない", () => {
      const output = runPowerShellFixture<WslMountRecoveryFixtureResult>(`
$script:terminateCount = 0
$script:persistCount = 0
$script:sleepCount = 0
$persistRecoveryAttempt = {
    param($DistributionName, $AttemptAt)
    $script:persistCount += 1
    throw "state unavailable"
}
$terminateDistribution = {
    param($DistributionName)
    $script:terminateCount += 1
}
$sleepAction = {
    param($Seconds)
    $script:sleepCount += 1
}
$logAction = { param($Message) }
$result = Invoke-WslMountNamespaceRecovery \
    -Distribution "Ubuntu-Backup" \
    -ConsecutiveFailureCount 2 \
    -RequiredConsecutiveFailures 2 \
    -LastRecoveryAt $null \
    -RecoveryDelaySeconds 10 \
    -PersistRecoveryAttempt $persistRecoveryAttempt \
    -TerminateDistribution $terminateDistribution \
    -SleepAction $sleepAction \
    -LogAction $logAction
[pscustomobject]@{
    Result = $result
    PersistCount = $script:persistCount
    TerminateCount = $script:terminateCount
    SleepCount = $script:sleepCount
} | ConvertTo-Json -Depth 8 -Compress
`);

      expect(output.Result.Status).toBe("failed");
      expect(output.Result.Action).toBe("none");
      expect(output.PersistCount).toBe(1);
      expect(output.TerminateCount).toBe(0);
      expect(output.SleepCount).toBe(0);
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
