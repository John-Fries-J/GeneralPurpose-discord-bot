FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg yt-dlp

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "run", "run"]
