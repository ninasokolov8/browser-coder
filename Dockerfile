# Development Dockerfile - SECURITY HARDENED
FROM node:20-alpine

# Install language runtimes for code execution
# dotnet8-sdk provides C# (.NET 8) compilation/execution support
RUN apk add --no-cache python3 openjdk17-jdk php bash dotnet8-sdk

# .NET environment
ENV DOTNET_NOLOGO=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false

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
