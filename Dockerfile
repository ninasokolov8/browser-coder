FROM node:20-alpine

# Install language runtimes for code execution
RUN apk add --no-cache python3 openjdk17-jdk php bash

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000 3001

CMD ["node", "server.mjs"]
