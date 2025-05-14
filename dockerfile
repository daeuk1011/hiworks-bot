# 빌드 스테이지
FROM node:20-bookworm AS builder

# pnpm 설치
RUN npm install -g pnpm

# Playwright 설치 (Chromium만)
RUN npx -y playwright@1.52.0 install --with-deps chromium

WORKDIR /app

# 의존성 파일 복사 및 설치 (캐시 활용)
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set store-dir /root/.pnpm-store && \
    pnpm install --frozen-lockfile --prefer-offline

# 소스 코드 복사 및 빌드
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN pnpm build

# 실행 스테이지
FROM node:20-bookworm

# Playwright 설치 (Chromium만)
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# pnpm 설치
RUN npm install -g pnpm

WORKDIR /app

# 프로덕션 의존성 설치
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set store-dir /root/.pnpm-store && \
    pnpm install --frozen-lockfile --prod --prefer-offline

# 빌드 결과물 복사
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]