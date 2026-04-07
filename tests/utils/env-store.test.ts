import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { updateEnvFile } from "../../src/utils/env-store";

describe("updateEnvFile", () => {
  let tmpDir: string;
  let envPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "twitchraid-test-"));
    envPath = path.join(tmpDir, ".env");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a new file when it does not exist", () => {
    updateEnvFile(envPath, { TWITCH_CLIENT_ID: "abc123" });
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("TWITCH_CLIENT_ID=abc123");
  });

  it("updates an existing key without disturbing other keys", () => {
    fs.writeFileSync(
      envPath,
      "TWITCH_CLIENT_ID=old\nDISCORD_WEBHOOK_URL=hook\n"
    );
    updateEnvFile(envPath, { TWITCH_CLIENT_ID: "new" });
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("TWITCH_CLIENT_ID=new");
    expect(content).toContain("DISCORD_WEBHOOK_URL=hook");
  });

  it("appends a new key that does not exist in the file", () => {
    fs.writeFileSync(envPath, "EXISTING=value\n");
    updateEnvFile(envPath, { NEW_KEY: "newval" });
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("NEW_KEY=newval");
    expect(content).toContain("EXISTING=value");
  });

  it("preserves comment lines", () => {
    fs.writeFileSync(envPath, "# This is a comment\nKEY=val\n");
    updateEnvFile(envPath, { KEY: "updated" });
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("# This is a comment");
  });

  it("preserves blank lines", () => {
    fs.writeFileSync(envPath, "KEY1=a\n\nKEY2=b\n");
    updateEnvFile(envPath, { KEY1: "x" });
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    expect(lines).toContain("");
  });

  it("creates a .backup file from the original", () => {
    fs.writeFileSync(envPath, "KEY=original\n");
    updateEnvFile(envPath, { KEY: "updated" });
    expect(fs.existsSync(envPath + ".backup")).toBe(true);
    const backup = fs.readFileSync(envPath + ".backup", "utf-8");
    expect(backup).toContain("KEY=original");
  });

  it("does not leave a .tmp file after successful write", () => {
    updateEnvFile(envPath, { KEY: "val" });
    expect(fs.existsSync(envPath + ".tmp")).toBe(false);
  });

  it("updates multiple keys in one call", () => {
    fs.writeFileSync(envPath, "A=1\nB=2\n");
    updateEnvFile(envPath, { A: "10", B: "20" });
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("A=10");
    expect(content).toContain("B=20");
  });
});
