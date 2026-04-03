# Build stage
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/gateway-core/package.json packages/gateway-core/
COPY packages/entity-model/package.json packages/entity-model/
COPY packages/coa-chain/package.json packages/coa-chain/
COPY packages/channel-sdk/package.json packages/channel-sdk/
COPY packages/agent-bridge/package.json packages/agent-bridge/
COPY packages/memory/package.json packages/memory/
COPY packages/voice/package.json packages/voice/
COPY packages/skills/package.json packages/skills/
COPY channels/telegram/package.json channels/telegram/
COPY channels/discord/package.json channels/discord/
COPY channels/signal/package.json channels/signal/
COPY config/package.json config/
COPY cli/package.json cli/

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Runtime stage
FROM node:22-slim AS runtime

RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

COPY --from=builder /app .

# Create data directory for SQLite
RUN mkdir -p /app/data

VOLUME ["/app/data"]

EXPOSE 3100

CMD ["pnpm", "start"]
