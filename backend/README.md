# DSCWeb News Backend

This backend ingests live news from GNews, stores only original summaries in a local database, and exposes `GET /api/news` for the frontend.

## Features

- Secure server-side API key usage (`GNEWS_API_KEY` in `.env`, never sent to browser)
- SQLite `news` table with category + edition date indexing
- Scheduled ingestion via cron (`NEWS_CRON`)
- On-demand refresh endpoint (`POST /api/news/refresh`)
- Frontend-compatible response shape for `js/news.js`

## Setup

1. Install dependencies:
   - `cd backend`
   - `npm install`
2. Configure environment:
   - Copy `.env.example` to `.env`
   - Set `GNEWS_API_KEY`
3. Start service:
   - `npm run start`

## Endpoints

- `GET /api/health`
- `GET /api/news`
- `GET /api/news?date=YYYY-MM-DD`
- `POST /api/news/refresh`

## Scheduler

- Controlled by `NEWS_CRON` (default: every hour at minute 15)
- `AUTO_REFRESH_ON_START=true` fetches once during startup

## Table

`news` table schema is defined in `db/init.sql`.

### Storage policy

Only original summary text from the provider (`description`/`content`) is stored in `summary`.
No rewriting/paraphrasing is performed by the backend.
