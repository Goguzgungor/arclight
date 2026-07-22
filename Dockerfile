FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
COPY packages/operator/package.json packages/operator/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm -r build \
  && pnpm --filter @arckive/worker deploy --legacy --prod /out/worker \
  && pnpm --filter @arckive/operator deploy --legacy --prod /out/operator

FROM node:22-slim AS worker
WORKDIR /app
COPY --from=build /out/worker .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]

FROM node:22-slim AS operator
WORKDIR /app
COPY --from=build /out/operator .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
