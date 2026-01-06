#!/bin/bash
# DigitalOcean Droplet Setup Script for Browser Coder
# Run this ONCE on a fresh Ubuntu droplet
#
# Usage: 
#   curl -sSL https://raw.githubusercontent.com/ninasokolov8/browser-coder/main/scripts/setup-droplet.sh | bash
#   OR
#   scp scripts/setup-droplet.sh root@YOUR_DROPLET_IP:~ && ssh root@YOUR_DROPLET_IP 'bash setup-droplet.sh'

set -e

echo "🚀 Setting up Browser Coder on DigitalOcean..."

# Update system
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    apt-get install -y docker-compose-plugin
    # Create alias for convenience
    echo 'alias docker-compose="docker compose"' >> ~/.bashrc
fi

# Install Git
echo "📦 Installing Git..."
apt-get install -y git

# Create app directory
echo "📁 Creating application directory..."
mkdir -p ~/browser-coder
cd ~/browser-coder

# Clone repository (replace with your repo URL)
echo "📥 Cloning repository..."
if [ ! -d ".git" ]; then
    echo "📥 Cloning repository..."
    git clone https://github.com/ninasokolov8/browser-coder.git ~/browser-coder
    echo ""
    echo "   Or if private, use SSH:"
    echo "   git clone git@github.com:ninasokolov8/browser-coder.git ~/browser-coder"
fi

# Setup firewall
echo "🔥 Configuring firewall..."
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS (for future SSL)
ufw --force enable

# Create docker network if needed
docker network create browser-coder-network 2>/dev/null || true

# Setup swap (helps on smaller droplets)
echo "💾 Setting up swap..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Enable automatic security updates
echo "🔒 Enabling automatic security updates..."
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. If not already cloned:"
echo "   git clone https://github.com/ninasokolov8/browser-coder.git ~/browser-coder"
echo ""
echo "2. Start the application:"
echo "   cd ~/browser-coder && docker compose up -d"
echo ""
echo "3. Setup GitHub Secrets for CI/CD:"
echo "   - DO_HOST: $(curl -s ifconfig.me)"
echo "   - DO_USERNAME: root"
echo "   - DO_SSH_KEY: (your private SSH key)"
echo ""
echo "4. (Optional) Setup SSL with Certbot:"
echo "   apt-get install certbot python3-certbot-nginx"
echo ""
