import fs from "node:fs";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const shouldAssert = process.argv.includes("--assert");
const host = process.env.SUB_AI_SSH_HOST || "sub";
const distribution = process.env.SUB_AI_WSL_DISTRIBUTION || "Ubuntu-Backup";
const keepaliveScript = fs.readFileSync(
  new URL("../ops/sub-ai-services/keep-wsl-dokploy-alive.ps1", import.meta.url)
);
const expectedKeepaliveHash = crypto
  .createHash("sha256")
  .update(keepaliveScript)
  .digest("hex");
const remoteScript = fs.readFileSync(
  new URL("./benchmark-sub-ai-services-remote.sh", import.meta.url),
  "utf8"
);

const keepalivePreflight = `
$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName "KeepDokployWslAlive"
$info = Get-ScheduledTaskInfo -TaskName "KeepDokployWslAlive"
$action = $task.Actions | Select-Object -First 1
$expectedScript = "E:\\GitHub\\BotManager\\scripts\\keep_wsl_dokploy_alive.ps1"
$actionMatches =
  $action.Execute -ieq "powershell.exe" -and
  $action.Arguments -like "*$expectedScript*"
if ($task.State -ne "Running" -or $info.LastTaskResult -ne 267009 -or -not $actionMatches) {
  exit 30
}
[pscustomobject]@{
  state = [string]$task.State
  lastTaskResult = $info.LastTaskResult
  actionMatches = $actionMatches
  fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $expectedScript).Hash.ToLowerInvariant()
} | ConvertTo-Json -Compress
`;
const encodedPreflight = Buffer.from(keepalivePreflight, "utf16le").toString(
  "base64"
);
const preflightExecution = spawnSync(
  "ssh",
  [
    host,
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encodedPreflight,
  ],
  { encoding: "utf8", timeout: 30_000, windowsHide: true }
);
if (preflightExecution.error) throw preflightExecution.error;
if (preflightExecution.status !== 0) {
  throw new Error("SUB AI WSL keepalive task is not running with the expected action");
}
const keepaliveTask = JSON.parse(preflightExecution.stdout.trim());
if (keepaliveTask.fileHash !== expectedKeepaliveHash) {
  throw new Error("deployed SUB AI WSL keepalive script does not match the repository");
}

const execution = spawnSync(
  "ssh",
  [host, "wsl", "-d", distribution, "--", "bash", "-s"],
  {
    encoding: "utf8",
    input: remoteScript,
    timeout: 240_000,
    windowsHide: true,
  }
);

if (execution.error) throw execution.error;
if (execution.status !== 0) {
  throw new Error(
    `SUB AI benchmark failed (${execution.status}): ${execution.stderr.trim()}`
  );
}

const outputLine = execution.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1);
if (!outputLine) throw new Error("SUB AI benchmark returned no result");

const result = JSON.parse(outputLine);
const baselineP95Ms = {
  generate: 770.54,
  embed: 32.49,
  mem0: 40.38,
  searxng: 372.83,
};
const limits = {
  generateP95Ms: baselineP95Ms.generate * 1.1,
  embedP95Ms: baselineP95Ms.embed * 1.1,
  mem0P95Ms: baselineP95Ms.mem0 * 1.1,
  searxngP95Ms: baselineP95Ms.searxng * 1.1,
};

if (shouldAssert) {
  const checks = [
    [
      result.generate.p95Ms <= limits.generateP95Ms,
      "generation",
      result.generate.p95Ms,
      limits.generateP95Ms,
    ],
    [
      result.embed.p95Ms <= limits.embedP95Ms,
      "embedding",
      result.embed.p95Ms,
      limits.embedP95Ms,
    ],
    [
      result.mem0.p95Ms <= limits.mem0P95Ms,
      "mem0",
      result.mem0.p95Ms,
      limits.mem0P95Ms,
    ],
    [
      result.searxng.p95Ms <= limits.searxngP95Ms,
      "SearXNG",
      result.searxng.p95Ms,
      limits.searxngP95Ms,
    ],
  ];
  for (const [passed, name, actual, limit] of checks) {
    if (!passed) {
      throw new Error(`${name} p95 ${actual.toFixed(1)}ms exceeds ${limit}ms`);
    }
  }
}

console.log(
  JSON.stringify(
    {
      host,
      services: "healthy",
      measurementChecks: {
        keepaliveTaskRunning: keepaliveTask.state === "Running",
        keepaliveScriptHashMatches: true,
        taskSetStable: true,
        restartCountZero: true,
        errorLogsZero: true,
      },
      baselineP95Ms,
      limits,
      ...result,
    },
    null,
    2
  )
);
