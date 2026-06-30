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
