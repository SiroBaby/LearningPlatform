FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base

WORKDIR /app

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "const http=require('node:http');const request=http.get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/',timeout:3000},response=>{process.exit(response.statusCode>=200&&response.statusCode<400?0:1)});request.on('error',()=>process.exit(1));request.on('timeout',()=>{request.destroy();process.exit(1)});"]

CMD ["node", "server.js"]
