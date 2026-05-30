import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Config } from "../src/config";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  restartProcess: vi.fn(),
  saveLastRestart: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
}));

vi.mock("../src/utils/process-restart", () => ({
  restartProcess: mocks.restartProcess,
}));

vi.mock("../src/utils/restart-state-store", () => ({
  loadLastRestart: vi.fn(() => 100),
  saveLastRestart: mocks.saveLastRestart,
  evaluateRestart: vi.fn(() => [false, 100]),
}));

vi.mock("../src/utils/logger", () => ({
  default: {
    info: mocks.info,
    error: mocks.error,
  },
}));

import { GitManager } from "../src/git-manager";

function makeConfig(): Config {
  return {
    updateCheckInterval: 600,
    restartCheckInterval: 300,
    restartInterval: 86_400,
    restartFile: "last_restart.txt",
  } as Config;
}

describe("GitManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restarts immediately after git pull updates even during restart cooldown", () => {
    const manager = new GitManager(makeConfig());
    vi.spyOn(manager, "shouldRestart").mockReturnValue(false);
    mocks.execSync.mockImplementation((command: string) => {
      if (command === "git pull") return "Updating 1..2\nFast-forward";
      if (command === "npm run build") return "build ok";
      throw new Error(`unexpected command: ${command}`);
    });

    manager.pullAndRestartIfUpdated();

    expect(mocks.restartProcess).toHaveBeenCalledOnce();
    expect(manager.shouldRestart).not.toHaveBeenCalled();
    expect(manager.restartPending).toBe(false);
  });

  it("restarts immediately after update watcher pulls remote changes", () => {
    const manager = new GitManager(makeConfig());
    vi.spyOn(manager, "shouldRestart").mockReturnValue(false);
    mocks.execSync.mockImplementation((command: string) => {
      if (command === "git rev-parse --abbrev-ref HEAD") return "main\n";
      if (command === "git fetch") return "";
      if (command === "git rev-list HEAD...origin/main --count") return "1\n";
      if (command === "git pull") return "Updating 1..2\nFast-forward";
      if (command === "npm run build") return "build ok";
      throw new Error(`unexpected command: ${command}`);
    });

    const updated = manager.checkForUpdates();

    expect(updated).toBe(true);
    expect(mocks.restartProcess).toHaveBeenCalledOnce();
    expect(manager.shouldRestart).not.toHaveBeenCalled();
    expect(manager.restartPending).toBe(false);
  });
});
