# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jellyfin Web Downloader - a full-stack TypeScript/Node.js application that downloads transcoded videos from Jellyfin servers via HLS streaming. Features a queue system with configurable concurrent downloads (1-20), resume capability for failed downloads, and real-time WebSocket progress updates.

## Commands

```bash
# Development (with ts-node)
npm run dev

# Production build
npm run build
npm start

# Install dependencies
npm install
```

All source code is in `web/` directory. Run commands from `web/`.

## Architecture

```
web/
├── client/           # SPA frontend (vanilla JS)
│   ├── index.html
│   ├── js/
│   │   ├── app.js      # Main UI logic
│   │   ├── api.js      # REST client
│   │   └── download.js # Download UI
│   └── css/
├── server/           # Express backend (TypeScript)
│   ├── index.ts        # Entry point, Express + WebSocket setup
│   ├── config.ts       # Environment config
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   ├── middleware/     # Auth, error handling
│   └── websocket/      # Real-time progress
├── downloads/        # Completed files (generated)
├── temp/             # Segment cache + sessions (generated)
└── data/             # Settings persistence (generated)
```

## Key Data Flows

**Authentication:** Client → `/api/auth/connect` (test URL) → `/api/auth/login` → session stored in `req.session.jellyfin` → `requireAuth` middleware validates subsequent requests

**Download Pipeline:**
1. User selects item + quality preset → `POST /api/download/start`
2. `downloadService` queues session, manages concurrent limit
3. `segmentService` fetches HLS playlist, downloads segments (3 concurrent, 8 retries each)
4. Segments cached in `temp/{sessionId}/`, state saved after each segment
5. ffmpeg muxes init + media segments into MP4 in `downloads/`
6. WebSocket at `/ws` broadcasts progress updates

## Service Layer

- **jellyfinService** - Jellyfin API wrapper (auth, library browsing, HLS URL building)
- **downloadService** - Queue management, session orchestration, resume handling
- **segmentService** - HLS segment downloading, ffmpeg muxing, retry logic
- **hlsParser** - Parses master → media playlist → segment URLs
- **settingsService** - Persists app config to `data/settings.json`

Services are singletons. Download sessions persisted to `temp/{id}/state.json` for crash recovery.

## Transcode Presets

| Preset | Resolution | Video Bitrate | Audio Bitrate |
|--------|-----------|---------------|---------------|
| low | 854p | 1 Mbps | 128 kbps |
| medium | 1280p | 2.5 Mbps | 192 kbps |
| high | 1920p | 5 Mbps | 256 kbps |
| veryHigh | 1920p | 8 Mbps | 320 kbps |

## Environment Variables

Key config in `config.ts` (defaults in parentheses):
- `PORT` (6942)
- `SESSION_SECRET` (change for production)
- `MAX_CONCURRENT_SEGMENTS` (3) - segments downloaded in parallel per file
- `MAX_RETRIES` (5) - retry attempts per segment
- `SEGMENT_TIMEOUT_MS` (120000) - 2 min timeout per segment

## Error Handling Patterns

- Segment downloads use exponential backoff: 3s, 6s, 9s... up to 15s
- Segments validated as MP4 box format (rejects JSON error responses)
- Failed downloads restore from `state.json` on server restart
- Jellyfin API errors handled with specific messages (auth failures, 404s, connection errors)
