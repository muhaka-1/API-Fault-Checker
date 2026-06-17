# API Fault Checker

Real-time fault monitoring for Meta, Amazon AWS, and Google Cloud APIs — with a live web dashboard, Slack alerts, and PagerDuty integration.

---

## Project structure

```
api-fault-checker/
├── src/
│   ├── index.js        ← Main entry point + scheduler
│   ├── checker.js      ← Endpoint polling engine
│   ├── alerts.js       ← Slack / PagerDuty dispatcher
│   └── logger.js       ← Winston structured logger
├── config/
│   └── endpoints.js    ← All APIs to monitor (edit this)
├── dashboard/
│   └── public/
│       └── index.html  ← Live web dashboard (Socket.IO)
├── scripts/
│   ├── check-once.js          ← One-shot check, no alerts
│   ├── test-alerts.js         ← Test Slack + PagerDuty
│   ├── api-fault-checker.service  ← systemd service file
│   └── nginx.conf             ← Nginx reverse proxy config
├── logs/                      ← Created automatically
├── .env.example               ← Copy this to .env
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Quick start in VS Code

### 1. Prerequisites

Install Node.js 18+ from https://nodejs.org

Verify:
```bash
node --version   # should print v18.x.x or higher
npm --version
```

### 2. Open the project

```bash
# Unzip the downloaded file, then:
cd api-fault-checker
code .           # opens VS Code
```

### 3. Install dependencies

Open the VS Code terminal (Ctrl+` or Cmd+`) and run:

```bash
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
```

Open `.env` in VS Code and fill in your keys:

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/REAL/URL
PAGERDUTY_INTEGRATION_KEY=your_real_key_here
```

> **To get a Slack webhook:**
> 1. Go to https://api.slack.com/apps
> 2. Create an app → "From scratch"
> 3. Features → Incoming Webhooks → turn on → Add New Webhook
> 4. Copy the URL into .env
>
> **To get a PagerDuty key:**
> 1. PagerDuty → Services → your service → Integrations tab
> 2. Add Integration → Events API v2
> 3. Copy the Integration Key into .env

### 5. Run a one-shot check (no alerts, good for testing)

```bash
npm run check-once
```

You'll see colored output like:

```
✓ Meta       Graph API          200   145ms      ok
✓ Amazon     S3                 403   88ms       ok
✗ Amazon     DynamoDB           503   920ms      P0
✓ Google     Cloud Run          401   167ms      ok
```

### 6. Test your alert channels

```bash
npm test
```

This sends a fake P0 alert to Slack and PagerDuty — check your channel/inbox.

### 7. Start the full system

```bash
npm start
```

This starts:
- The poller (runs every minute by default)
- The dashboard at http://localhost:3000

Open http://localhost:3000 in your browser to see the live dashboard.

### 8. Dev mode (auto-restart on file changes)

```bash
npm run dev
```

---

## VS Code recommended extensions

Install these for the best experience:

- **ESLint** — `dbaeumer.vscode-eslint`
- **REST Client** — `humao.rest-client` (test API calls in-editor)
- **DotENV** — `mikestead.dotenv` (highlights .env files)
- **Thunder Client** — `rangav.vscode-thunder-client` (API testing)

---

## Configuration reference

All config lives in `.env`. Key settings:

| Variable | Default | Description |
|---|---|---|
| `POLL_CRON` | `*/1 * * * *` | Cron schedule for polling |
| `LATENCY_WARN_MS` | `300` | Latency threshold for P2 |
| `LATENCY_CRIT_MS` | `1000` | Latency threshold for P1 |
| `ALERT_COOLDOWN_MINUTES` | `10` | Min time between alerts per service |
| `DASHBOARD_PORT` | `3000` | Web dashboard port |
| `DASHBOARD_ENABLED` | `true` | Set false to disable dashboard |

To add your own endpoints, edit `config/endpoints.js`.

---

## Deploying to a real server

### Option A — Linux VPS (Ubuntu/Debian) with systemd

This is the recommended production setup for a dedicated server (AWS EC2, DigitalOcean Droplet, Linode, Hetzner, etc).

#### Step 1 — Provision a server

Minimum spec: 1 vCPU, 512 MB RAM, Ubuntu 22.04.

SSH in:
```bash
ssh ubuntu@YOUR_SERVER_IP
```

#### Step 2 — Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # confirm v20.x
```

#### Step 3 — Upload the project

From your local machine:
```bash
scp -r api-fault-checker ubuntu@YOUR_SERVER_IP:/opt/
```

Or clone from GitHub if you pushed it there:
```bash
git clone https://github.com/yourname/api-fault-checker /opt/api-fault-checker
```

#### Step 4 — Install dependencies on the server

```bash
cd /opt/api-fault-checker
npm ci --only=production
```

#### Step 5 — Create the .env file on the server

```bash
cp .env.example .env
nano .env        # fill in your real keys
```

#### Step 6 — Install as a systemd service

```bash
sudo cp scripts/api-fault-checker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable api-fault-checker
sudo systemctl start api-fault-checker
```

Check it's running:
```bash
sudo systemctl status api-fault-checker
sudo journalctl -u api-fault-checker -f   # live logs
```

#### Step 7 — Set up Nginx reverse proxy

```bash
sudo apt install -y nginx
sudo cp scripts/nginx.conf /etc/nginx/sites-available/api-fault-checker
sudo ln -s /etc/nginx/sites-available/api-fault-checker /etc/nginx/sites-enabled/
```

Edit the config to put in your domain or IP:
```bash
sudo nano /etc/nginx/sites-available/api-fault-checker
# change: server_name your-domain.com;
```

Test and reload Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

#### Step 8 — Add free SSL (HTTPS)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot auto-renews. Your dashboard is now at https://your-domain.com

#### Step 9 — Open firewall ports

```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

---

### Option B — Docker (any server or cloud)

Works on any machine with Docker installed.

```bash
# On the server:
git clone https://github.com/yourname/api-fault-checker
cd api-fault-checker
cp .env.example .env
nano .env    # fill in keys

docker compose up -d
docker compose logs -f   # watch logs
```

Dashboard at http://YOUR_SERVER_IP:3000

---

### Option C — Railway / Render / Fly.io (zero-config cloud)

**Railway** (easiest, free tier available):

1. Push your code to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo
4. In the Variables tab, paste all your .env values
5. Railway auto-detects Node.js and deploys

Dashboard URL given automatically.

---

## Keeping the server up

Once deployed with systemd, the service:
- Starts automatically on server reboot
- Restarts itself if it crashes (RestartSec=10)
- Logs to systemd journal (view with `journalctl`)
- Writes rotating log files to `/opt/api-fault-checker/logs/`

To update after code changes:
```bash
cd /opt/api-fault-checker
git pull
npm ci --only=production
sudo systemctl restart api-fault-checker
```

---

## Troubleshooting

**No alerts firing:**
- Run `npm test` to verify webhook URLs work
- Check cooldown: alerts won't re-fire within `ALERT_COOLDOWN_MINUTES`
- Check logs: `sudo journalctl -u api-fault-checker --since "5 min ago"`

**Dashboard shows "connecting…":**
- Make sure the server is running: `sudo systemctl status api-fault-checker`
- Check port 3000 is open and Nginx is proxying correctly

**All endpoints showing as down:**
- Your server may not have outbound internet access
- Check: `curl https://graph.facebook.com/` from the server

**Latency looks very high:**
- This is normal if your server is far from the API regions
- Adjust `LATENCY_WARN_MS` and `LATENCY_CRIT_MS` accordingly
