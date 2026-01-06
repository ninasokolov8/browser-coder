# Development Dockerfile - SECURITY HARDENED
FROM node:20-alpine

# Install language runtimes for code execution
RUN apk add --no-cache python3 openjdk17-jdk php bash

# SECURITY: Create non-root user
RUN addgroup -g 1001 -S app && \
    adduser -u 1001 -S app -G app -h /home/app

# SECURITY: Create isolated sandbox directory
RUN mkdir -p /app/sandbox && chown app:app /app/sandbox && chmod 700 /app/sandbox

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# SECURITY: Set ownership
RUN chown -R app:app /app

# Note: In development, we run as root for hot-reload, but production uses 'app' user
# USER app

ENV TMPDIR=/app/sandbox

EXPOSE 3000 3001

CMD ["node", "server.mjs"]
