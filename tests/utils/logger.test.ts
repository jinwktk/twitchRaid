import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransformableInfo } from "logform";
import os from "node:os";

const transportRecords = vi.hoisted(() => ({
  daily: [] as string[],
}));

vi.mock("winston-daily-rotate-file", async () => {
  const { default: Transport } = await import("winston-transport");

  class RecordingDailyRotateFile extends Transport {
    log(info: TransformableInfo, callback: () => void): void {
      transportRecords.daily.push(String(info[Symbol.for("message")]));
      callback();
    }
  }

  return { default: RecordingDailyRotateFile };
});

describe("logger transports", () => {
  beforeEach(() => {
    transportRecords.daily.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 34, 56));
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the application timestamp in the daily file record", async () => {
    const { default: logger } = await import("../../src/utils/logger");

    logger.info("daily record");

    expect(transportRecords.daily).toEqual([
      "2026-07-20 12:34:56 [INFO] daily record",
    ]);
    logger.close();
  });

  it("writes the console record without the application timestamp", async () => {
    const { default: logger } = await import("../../src/utils/logger");
    const stdout = (console as Console & { _stdout: NodeJS.WritableStream })
      ._stdout;
    const stdoutWrite = vi
      .spyOn(stdout, "write")
      .mockImplementation(() => true);

    logger.log("success", "console record");

    const consoleOutput = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    expect(consoleOutput).toBe(`[SUCCESS] console record${os.EOL}`);
    logger.close();
  });

  it("keeps file-only records in the daily file and excludes them from console", async () => {
    const { default: logger } = await import("../../src/utils/logger");
    const stdout = (console as Console & { _stdout: NodeJS.WritableStream })
      ._stdout;
    const stdoutWrite = vi
      .spyOn(stdout, "write")
      .mockImplementation(() => true);

    logger.log("info", "file-only record", { fileOnly: true });

    expect(transportRecords.daily).toEqual([
      "2026-07-20 12:34:56 [INFO] file-only record",
    ]);
    expect(stdoutWrite).not.toHaveBeenCalled();
    logger.close();
  });
});
