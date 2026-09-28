FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "run", "run"]
