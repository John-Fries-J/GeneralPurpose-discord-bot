FROM node:22-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --omit=dev

FROM node:22-alpine AS activity-client

WORKDIR /app/activity/client

COPY activity/client/package*.json ./
RUN npm ci

COPY activity/client ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg yt-dlp libstdc++

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./

COPY . .
COPY --from=activity-client /app/activity/client/dist ./activity/client/dist

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "run", "run"]
