FROM node:24-bookworm-slim

WORKDIR /app

ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision=$VCS_REF

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

RUN git config --system --add safe.directory /mnt/e/GitHub/RukalunPage

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
