FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base

WORKDIR /app

FROM base AS build

COPY package.json package-lock.json ./
COPY scripts/patch-runtime-dependencies.cjs ./scripts/patch-runtime-dependencies.cjs
RUN npm ci

COPY . ./
RUN npm run build

FROM base AS production-dependencies

COPY package.json package-lock.json ./
COPY scripts/patch-runtime-dependencies.cjs ./scripts/patch-runtime-dependencies.cjs
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const http=require('node:http');const request=http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/api/v1/health',timeout:3000},response=>{process.exit(response.statusCode===200?0:1)});request.on('error',()=>process.exit(1));request.on('timeout',()=>{request.destroy();process.exit(1)});"]

CMD ["npm", "run", "start:prod"]
