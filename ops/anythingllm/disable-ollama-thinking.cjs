const fs = require("node:fs");

const providerPath = "/app/server/utils/AiProviders/ollama/index.js";
const source = fs.readFileSync(providerPath, "utf8");
const chatCallPattern = /(\s+model: this\.model,\r?\n)(\s+stream:)/g;
const callSiteCount = [...source.matchAll(chatCallPattern)].length;

if (callSiteCount !== 2) {
  throw new Error(
    `expected 2 Ollama chat call sites, found ${callSiteCount}; refusing to patch`
  );
}

const patched = source.replace(
  chatCallPattern,
  (_match, modelLine, streamLine) =>
    `${modelLine}${streamLine.replace("stream:", "think: false,")}\n${streamLine}`
);
if ((patched.match(/think: false/g) ?? []).length !== 2) {
  throw new Error("failed to disable thinking for both Ollama chat call sites");
}

fs.writeFileSync(providerPath, patched, "utf8");
