# 빌드 스테이지
FROM node:22-bookworm-slim AS builder

# 필요한 시스템 의존성 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# pnpm 설치
RUN corepack enable && corepack prepare pnpm@latest --activate

# Playwright 의존성 설치 (Chromium만)
RUN pnpm create playwright@1.52.0 && \
    cd /tmp && pnpm exec playwright install --with-deps chromium && \
    rm -rf /tmp/node_modules

WORKDIR /app

# 의존성 설치
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set store-dir /root/.pnpm-store && \
    pnpm install --frozen-lockfile --prefer-offline

# 소스 코드 복사 및 빌드
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm build

# 실행 스테이지
FROM node:22-bookworm-slim

# Playwright 실행에 필요한 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Playwright 브라우저 복사
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# pnpm 설치
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 프로덕션 의존성 설치
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set store-dir /root/.pnpm-store && \
    pnpm install --frozen-lockfile --prod --prefer-offline

# 빌드 결과물 복사
COPY --from=builder /app/dist ./dist

# 비루트 사용자 실행
USER node

CMD ["pnpm", "start:prod"]