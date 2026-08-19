#!/usr/bin/env bash
# One-shot provisioner for a fresh Amazon Lightsail Ubuntu 22.04/24.04 instance.
# Installs Docker + Compose, then brings up the Reader stack.
#
# Usage (on the instance, from the repo's deploy/ directory):
#   cp env.example .env && nano .env      # set READER_TOKEN (+ READER_DOMAIN for HTTPS)
#   ./setup-lightsail.sh                   # HTTPS via Caddy (needs a domain)
#   ./setup-lightsail.sh ip                # or: IP-only over HTTP on :8787
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-domain}"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker Engine + Compose plugin"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

if [ ! -f .env ]; then
  echo "ERROR: create .env first:  cp env.example .env && nano .env" >&2
  exit 1
fi

COMPOSE_FILE="docker-compose.yml"
[ "$MODE" = "ip" ] && COMPOSE_FILE="docker-compose.ip.yml"

echo "==> Building and starting ($COMPOSE_FILE)"
sudo docker compose -f "$COMPOSE_FILE" up -d --build

echo
echo "==> Done. Reader is running."
if [ "$MODE" = "ip" ]; then
  IP="$(curl -s http://checkip.amazonaws.com || echo '<instance-ip>')"
  echo "    API:  http://${IP}:8787   (open port 8787 in Lightsail networking)"
  echo "    In the app Settings, set Base URL to http://${IP}:8787 and the READER_TOKEN."
else
  echo "    API:  https://\$READER_DOMAIN   (open ports 80 + 443 in Lightsail networking;"
  echo "          point the domain's A record at this instance's public IP)"
  echo "    In the app Settings, set Base URL to https://<your-domain> and the READER_TOKEN."
fi
echo "    Logs:   sudo docker compose -f $COMPOSE_FILE logs -f reader"
echo "    Re-seed/poll now:  sudo docker compose -f $COMPOSE_FILE exec reader node dist/entry.mjs poll --all"
