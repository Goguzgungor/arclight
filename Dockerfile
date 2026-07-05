FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm -r build && pnpm --filter @arclight/worker deploy --legacy --prod /out

FROM node:22-slim
WORKDIR /app
COPY --from=build /out .
USER node
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
