# Development Dockerfile - SECURITY HARDENED
FROM node:20-alpine

# Install language runtimes for code execution
# dotnet8-sdk provides C# (.NET 8) compilation/execution support
# php-pecl-xdebug is the PHP debugger. It is NOT loaded by default - nothing here
# enables it in php.ini - so an ordinary run pays nothing for it. The debug adapter
# turns it on per process with -dzend_extension=xdebug.
RUN apk add --no-cache python3 openjdk17-jdk php php-pecl-xdebug bash dotnet8-sdk curl

# The C# debugger.
#
# netcoredbg, the obvious choice, BUILDS on Alpine and then segfaults the moment it
# launches a program: on musl CoreCLR's PAL probes the stack with _alloca(1.5 MB) from
# a thread whose stack is exactly 1.5 MB (dotnet/runtime#103741, Samsung/netcoredbg#206,
# both open). dncdbg is the netcoredbg maintainer's own fork with that fixed, and the
# only .NET debugger that publishes a linux-musl-x64 build. See blueprint section 49.
ARG DNCDBG_VERSION=1.1.0
RUN mkdir -p /opt/stage && \
    curl -sSL "https://github.com/viewizard/dncdbg/releases/download/v${DNCDBG_VERSION}/dncdbg-${DNCDBG_VERSION}-linux-musl-x64.tar.gz" \
      | tar -xz -C /opt/stage 2>/dev/null; \
    mv /opt/stage/dncdbg /opt/dncdbg && rm -rf /opt/stage /opt/dncdbg/._* && \
    chmod 755 /opt/dncdbg/dncdbg && /opt/dncdbg/dncdbg --version

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
