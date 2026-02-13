# Deployment Guide (Vercel + Worker)

## Recommended architecture
- Web UI/API (light): Vercel
- Scrape worker (Playwright): separate server (Railway, Render, Fly.io, VPS)
- Database: PostgreSQL (shared by both)
- Storage: local or object storage for CSV artifacts

Playwright jobs are long-running and browser-dependent, so do not rely on Vercel Serverless for full scraping runtime.

## Environment variables
Required on Web + Worker:
- `DATABASE_URL`
- `APP_LOGIN_ID`
- `APP_LOGIN_PASSWORD`
- `APP_AUTH_SECRET`

Required on Worker:
- `NAVER_CAFE_SESSION_FILE` (or mount default path)
- `GSHEET_WEBHOOK_URL` (optional but recommended)

## Startup commands
Web:
- `npm run build`
- `npm run start`

Worker:
- `npm run worker`

## Session handling
1. Run `npm run cafe:login` once in worker environment.
2. Keep session file persistent (volume mount).
3. Re-login when session expires.

## Google Sheets integration
Use Apps Script Web App endpoint as `GSHEET_WEBHOOK_URL`.
Payload sent by worker:
- `postRows`: post-level rows
- `commentRows`: comment-level rows
