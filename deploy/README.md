# Deploying the Reader backend to Amazon Lightsail

The backend is a single Node process with a SQLite file — cheap to run on the
smallest Lightsail instance. Two paths: **Docker (recommended)** or bare-metal
systemd. Data lives in a Docker volume (`reader-data`) or `/opt/reader/data`.

## 1. Create the instance
- Lightsail → Create instance → Linux/Unix → **Ubuntu 24.04**, smallest plan is fine.
- **Networking** tab → add firewall rules:
  - HTTPS path: open **80** and **443**.
  - IP-only path: open **8787**.
- (HTTPS only) Point a domain's **A record** at the instance's static public IP.

## 2. Copy the repo up and configure
```bash
# from your machine
scp -r reader ubuntu@<instance-ip>:~/reader          # or: git clone on the instance
ssh ubuntu@<instance-ip>
cd reader/deploy
cp env.example .env && nano .env                     # set READER_TOKEN (+ READER_DOMAIN for HTTPS)
```

## 3. Bring it up (Docker)
```bash
./setup-lightsail.sh          # HTTPS via Caddy (needs READER_DOMAIN + ports 80/443)
# or
./setup-lightsail.sh ip       # HTTP on :8787 using the instance IP
```
The script installs Docker, builds the image, and starts the stack. First boot
seeds the default sources (`seeds/reader.opml` + `seeds/sources.json`) and the
scheduler polls immediately. Verify:
```bash
curl -s https://<your-domain>/health         # or http://<ip>:8787/health
# {"ok":true,"sources":41,"items":...}
```

## 4. Point the app at it
In the iOS app → **Settings** → set **Base URL** to `https://<your-domain>`
(or `http://<ip>:8787`) and paste the same **READER_TOKEN**. Done.

## Operations
```bash
sudo docker compose logs -f reader                                   # logs
sudo docker compose exec reader node dist/entry.mjs poll --all       # force a full poll
sudo docker compose exec reader node dist/entry.mjs tag --limit 200  # run Haiku tagging (if enabled)
sudo docker compose pull && sudo docker compose up -d --build        # update
```
The SQLite DB persists in the `reader-data` volume across restarts/rebuilds.

## Bare-metal alternative (no Docker)
See `reader.service` — install Node 22 + pnpm, `pnpm install && pnpm build`,
seed once, create `.env`, then `systemctl enable --now reader`. Put Caddy or
nginx in front for TLS if you want HTTPS.

## Notes
- **Reddit** needs `REDDIT_CLIENT_ID/SECRET` (anonymous access is blocked). Without
  them, Reddit sources error cleanly and everything else works.
- **Auto-tagging** stays off unless `ANTHROPIC_API_KEY` + `TAG_LLM_ENABLED=true`.
- Backups: snapshot the instance, or copy the DB —
  `sudo docker compose cp reader:/data/reader.db ./reader-backup.db`.
