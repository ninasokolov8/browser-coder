# DigitalOcean Deployment Guide

## Quick Start (5 minutes)

### 1️⃣ Create DigitalOcean Droplet

```bash
# Recommended specs:
# - Ubuntu 24.04 LTS
# - 2GB RAM / 1 vCPU ($12/mo) - handles ~1000 concurrent users
# - 4GB RAM / 2 vCPU ($24/mo) - handles ~5000 concurrent users
# - Enable "Docker" from Marketplace for pre-installed Docker
```

### 2️⃣ Setup Droplet (One-time)

SSH into your droplet and run:

```bash
# Update and install essentials
apt update && apt upgrade -y
apt install -y git docker-compose-plugin

# Setup firewall
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable

# Clone your repo
git clone https://github.com/ninasokolov8/browser-coder.git ~/browser-coder
cd ~/browser-coder

# Start the app!
docker compose up -d
```

### 3️⃣ Setup GitHub Secrets (for auto-deploy)

Go to your GitHub repo → Settings → Secrets and variables → Actions

Add these secrets:

| Secret | Value |
|--------|-------|
| `DO_HOST` | Your droplet IP (e.g., `164.92.xxx.xxx`) |
| `DO_USERNAME` | `root` |
| `DO_SSH_KEY` | Your private SSH key (the one you added to DO) |

### 4️⃣ Generate SSH Key (if needed)

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_do_deploy

# Copy public key to droplet
ssh-copy-id -i ~/.ssh/github_do_deploy.pub root@YOUR_DROPLET_IP

# The PRIVATE key (~/.ssh/github_do_deploy) goes in GitHub Secrets as DO_SSH_KEY
cat ~/.ssh/github_do_deploy
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Workflow                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   git push main                                                  │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────┐                       │
│   │        GitHub Actions               │                       │
│   │   1. Build Docker image             │                       │
│   │   2. Push to ghcr.io                │                       │
│   │   3. SSH to droplet                 │                       │
│   └─────────────────────────────────────┘                       │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────┐                       │
│   │     DigitalOcean Droplet            │                       │
│   │   1. git pull                       │                       │
│   │   2. docker compose pull            │                       │
│   │   3. docker compose up -d           │                       │
│   └─────────────────────────────────────┘                       │
│        │                                                         │
│        ▼                                                         │
│   🎉 Live at http://YOUR_DROPLET_IP                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Optional: Add SSL (HTTPS)

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get certificate (replace with your domain)
certbot --nginx -d yourdomain.com

# Auto-renewal is set up automatically
```

---

## Optional: Use Docker Hub Instead of GitHub Registry

If you prefer Docker Hub, update `.github/workflows/deploy.yml`:

```yaml
env:
  REGISTRY: docker.io
  IMAGE_NAME: YOUR_DOCKERHUB_USER/browser-coder

# And add these secrets:
# DOCKERHUB_USERNAME
# DOCKERHUB_TOKEN
```

---

## Monitoring & Logs

```bash
# View logs
docker compose logs -f

# View specific service
docker compose logs -f api

# Check status
docker compose ps

# Restart
docker compose restart

# Full rebuild
docker compose down && docker compose up -d --build
```

---

## Troubleshooting

### Deployment fails with SSH error
- Ensure your SSH key is correct in GitHub Secrets
- Key should start with `-----BEGIN OPENSSH PRIVATE KEY-----`
- Check droplet allows SSH: `ufw status`

### Container keeps restarting
```bash
docker compose logs api --tail 100
```

### Out of disk space
```bash
docker system prune -a --volumes
```

### Out of memory (on small droplets)
Add swap:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
