# Cologic Security Architect

AI-assisted physical-security & ELV design tool. Upload a site drawing, auto-extract site facts, configure a solution tier, and generate a one-pager, full design report, HLD, manpower plan, and a deterministic BOQ (with Excel export).

## Stack
- **Backend:** Node.js + Express, SQLite (`better-sqlite3`), JWT auth, Anthropic Claude proxy
- **Frontend:** static HTML/CSS/JS (served by Express)

## Setup
```bash
npm install
cp .env.example .env   # then edit .env
npm start
```
Open http://localhost:3000

## Configuration
See `.env.example`. Key variables:
- `ANTHROPIC_API_KEY` — required for generation
- `JWT_SECRET` — **required in production**; in dev a secret is auto-generated and persisted to `.jwt_secret`
- `NODE_ENV=production` — enables strict CORS, trust-proxy, and hides error details
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — optional env-based admin login

## Accounts
Public sign-up is disabled (sign-in only). On first run, any accounts in a local
`users.json` are migrated into SQLite. After that, manage accounts in the database
or via the `ADMIN_*` env variables.

## Data
- `cologic.db` — SQLite database (users + projects). Gitignored.
- `users.json`, `projects.json` — legacy seed files, migrated once then ignored.

## Production notes
- Set `JWT_SECRET` and `NODE_ENV=production`.
- Run behind a TLS-terminating reverse proxy (the app trusts one proxy hop in prod).
- Back up `cologic.db` regularly.
- Health check: `GET /api/health`.

## Deploying on Railway
Set these under **Service → Variables** (the `.env` file is gitignored and is NOT deployed):

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | a long random string (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `ANTHROPIC_API_KEY` | your Anthropic key |
| `NODE_ENV` | `production` |
| `ADMIN_USERNAME` | login id (e.g. `cologic`) |
| `ADMIN_PASSWORD` | a strong password |

**Important — persistent storage:** Railway's container filesystem is ephemeral, so
`cologic.db` (users + saved projects) is wiped on every redeploy. To keep data:
1. Add a **Volume** to the service (e.g. mounted at `/data`).
2. Set `DB_PATH=/data/cologic.db` in Variables.

Without a volume, log in using the `ADMIN_USERNAME`/`ADMIN_PASSWORD` env account
(which doesn't depend on the database). `npm start` is the start command; the app
binds to Railway's injected `PORT` automatically.
