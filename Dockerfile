FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["npm", "run", "run"]
