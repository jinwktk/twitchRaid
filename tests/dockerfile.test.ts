import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Dockerfile", () => {
  it("starts the compiled bot directly without npm", () => {
    const dockerfilePath = path.join(process.cwd(), "Dockerfile");

    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toMatch(/CMD\s+\["npm",\s*"run",\s*"start"\]/);
    expect(dockerfile).not.toMatch(/CMD\s+\["npm",\s*"start"\]/);
  });

  it("keeps local runtime files out of the Docker build context", () => {
    const dockerignorePath = path.join(process.cwd(), ".dockerignore");

    expect(fs.existsSync(dockerignorePath)).toBe(true);

    const dockerignore = fs.readFileSync(dockerignorePath, "utf8");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain("dist");
    expect(dockerignore).toContain("logs");
  });
});
