# Browser Coder 🚀

A **production-ready, auto-scaling Web IDE** that supports 10,000+ concurrent users. Execute code in Python, JavaScript, TypeScript, Java, and PHP directly in your browser.

![Browser Coder](https://img.shields.io/badge/Browser-Coder-blue?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)
![Auto-Scale](https://img.shields.io/badge/Auto-Scale-green?style=for-the-badge)

## ⚡ One-Command Deployment

```bash
docker compose up -d
```

**That's it!** The system will:
- ✅ Build and start all services
- ✅ Enable automatic scaling (1-8 API instances based on load)
- ✅ Configure nginx load balancer
- ✅ Set up health checks and auto-recovery

Access at: **http://localhost**

## 🏗️ Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              NGINX                       │
                    │       (Load Balancer + CDN)             │
                    │         Port 80                          │
                    └─────────────┬───────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
     │   API #1    │     │   API #2    │     │   API #N    │
     │  (Smart     │     │  (Smart     │     │  (Smart     │
     │   Server)   │     │   Server)   │     │   Server)   │
     └─────────────┘     └─────────────┘     └─────────────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                    ┌─────────────▼───────────────┐
                    │        AUTOSCALER           │
                    │   (Monitors & Scales)       │
                    └─────────────────────────────┘
```

### Services

| Service | Purpose | Scaling |
|---------|---------|---------|
| **nginx** | Load balancer, static files, caching | Single instance |
| **api** | Code execution, smart caching | Auto-scale 1-8 replicas |
| **autoscaler** | Monitors load, scales API up/down | Single instance |

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_SCALE` | 8 | Maximum API replicas under heavy load |
| `MIN_REPLICAS` | 1 | Minimum API replicas (idle state) |
| `INITIAL_REPLICAS` | 2 | Starting number of API replicas |
| `RUN_TIMEOUT_MS` | 10000 | Code execution timeout (ms) |
| `RATE_LIMIT_MAX` | 200 | Max requests per minute per IP |

### Customizing Scale Limits

```bash
# Allow up to 16 API instances
MAX_SCALE=16 docker compose up -d

# Start with 4 replicas
INITIAL_REPLICAS=4 docker compose up -d

# Both together
MAX_SCALE=16 INITIAL_REPLICAS=4 MIN_REPLICAS=2 docker compose up -d
```

## 📊 Auto-Scaling Behavior

The autoscaler monitors CPU usage and request queue:

| Condition | Action |
|-----------|--------|
| CPU > 70% OR Queue > 50 | **Scale UP** (add 1 replica) |
| CPU < 30% AND Queue < 5 | **Scale DOWN** (remove 1 replica) |

**Cooldown:** 30 seconds between scaling actions to prevent thrashing.

### Monitoring

View autoscaler activity:
```bash
docker logs -f browser_coder-autoscaler-1
```

Example output:
```
[2026-01-05 21:24:39] 🚀 Auto-Scaler started
[2026-01-05 21:24:39] 📊 Config: MIN=1, MAX=8, CPU↑=70%, CPU↓=30%
[2026-01-05 21:24:57] 📈 Replicas: 2, CPU: 45.2%, Memory: 32.1%, Queue: 12
[2026-01-05 21:25:10] 📈 Replicas: 2, CPU: 78.5%, Memory: 41.3%, Queue: 67
[2026-01-05 21:25:10] ⬆️ Scale UP triggered (CPU: 78.5% > 70% or Queue: 67 > 50)
[2026-01-05 21:25:10] 🔄 Scaling browser_coder-api: 2 → 3 replicas
[2026-01-05 21:25:12] ✅ Started new API container
```

## 🚀 Production Deployment

### Cloud Deployment (AWS/GCP/Azure)

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd browser-coder
   ```

2. **Start production:**
   ```bash
   docker compose up -d
   ```

3. **Verify:**
   ```bash
   curl http://localhost/health
   # {"status":"healthy",...}
   ```

### Resource Requirements

| Load | Recommended Server | API Replicas |
|------|-------------------|--------------|
| Up to 1,000 users | 2 vCPU, 4GB RAM | 1-2 |
| Up to 5,000 users | 4 vCPU, 8GB RAM | 2-4 |
| Up to 10,000 users | 8 vCPU, 16GB RAM | 4-8 |
| 10,000+ users | 16 vCPU, 32GB RAM | 8-16 |

### High Availability Setup

For production with zero downtime:

```bash
# Scale to handle 10k+ concurrent users
MAX_SCALE=16 INITIAL_REPLICAS=4 docker compose up -d
```

## 🔌 API Reference

### Health Check
```bash
GET /health
# Response: {"status":"healthy","active":0,"load":"0.0%",...}
```

### List Languages
```bash
GET /api/languages
# Response: [{"id":"javascript","name":"JavaScript","versions":[...]}]
```

### Execute Code
```bash
POST /api/run
Content-Type: application/json

{
  "code": "print('Hello, World!')",
  "language": "python",
  "version": "python3"  # optional
}

# Response:
{
  "stdout": "Hello, World!",
  "stderr": "",
  "exitCode": 0,
  "durationMs": 45,
  "cached": false
}
```

## 📁 Project Structure

```
browser-coder/
├── docker-compose.yml      # One-command deployment
├── Dockerfile.production   # Optimized production image
├── Dockerfile.autoscaler   # Auto-scaling service
├── autoscaler.sh           # Scaling logic
├── server.mjs              # Smart API server
├── nginx/
│   └── nginx.conf          # Load balancer config
├── src/                    # Frontend (Monaco Editor)
├── languages/              # Language configurations
└── dist/                   # Built frontend (auto-generated)
```

## 🛠️ Development

### Local Development (with hot reload)

```bash
# Install dependencies
npm install

# Start dev mode with Vite
npm run dev
```

### Build Production Locally

```bash
npm run build
```

## 🐳 Docker Commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Check status
docker compose ps

# Stop all services
docker compose down

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d

# Clean everything
docker compose down -v --rmi all
```

## ⚡ Performance Features

### Built-in Optimizations

1. **LRU Cache with TTL** - Identical code executions are cached for 30 minutes
2. **Request Deduplication** - Concurrent identical requests share results
3. **Circuit Breaker** - Protects against cascade failures
4. **Connection Pooling** - Nginx maintains keepalive connections
5. **Gzip Compression** - All responses are compressed
6. **Static Asset Caching** - 1-year cache for JS/CSS

### Rate Limiting

- **30 requests/second** per IP to `/api/*`
- **Burst allowance:** 50 requests
- **Response:** HTTP 429 with `retryAfter` header

## 🔒 Security

- Non-root container execution
- Input sanitization
- Execution timeouts (10 seconds default)
- Resource limits per container
- Rate limiting and connection limits

## 📜 License

MIT License - feel free to use in personal and commercial projects.

---

**Built with ❤️ for developers who want to code anywhere.**
