FROM mintplexlabs/anythingllm:1.15.0@sha256:df8a540a06079c42c0835b40002e708bea895b5ab3c631d723c276a378a2857f

USER root
COPY ops/anythingllm/disable-ollama-thinking.cjs /tmp/disable-ollama-thinking.cjs
RUN node /tmp/disable-ollama-thinking.cjs && rm /tmp/disable-ollama-thinking.cjs

