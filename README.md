# JellyDown

A web-based video downloader for Jellyfin media servers. Download transcoded videos from your Jellyfin library with a clean, modern interface.

## Features

- **Web-Based Interface** - Access from any browser, no client installation needed
- **Quality Presets** - Choose from Low (1 Mbps) to Very High (8 Mbps) quality
- **Custom Presets** - Create your own transcoding presets with custom resolution, bitrate, and codec settings
- **Queue Management** - Download multiple videos with configurable concurrent downloads (1-20)
- **Resume Support** - Failed downloads can be resumed from where they left off
- **Real-Time Progress** - WebSocket-powered live progress updates with speed and ETA
- **Batch Downloads** - Select and download entire seasons or multiple episodes at once
- **File Retention** - Configure automatic cleanup with global defaults or per-file overrides
- **Saved Servers** - Save multiple Jellyfin servers for quick switching
- **Reverse Proxy Ready** - Works behind nginx, Traefik, Caddy, and other proxies
- **Cross-Platform** - Runs on Linux, macOS, and Windows

## Quick Start (Docker)

The easiest way to run JellyDown is with Docker:

```yaml
# docker-compose.yml
services:
  jellydown:
    image: dgatx/jellydown:latest
    ports:
      - "6942:6942"
    volumes:
      - ./downloads:/app/downloads
      - ./data:/app/data
      - ./temp:/app/temp
    restart: unless-stopped
```

```bash
docker compose up -d
```

Then open http://localhost:6942 in your browser.

## Manual Installation

### Prerequisites

- Node.js 20+
- ffmpeg (for video muxing)

### Steps

```bash
# Clone the repository
git clone https://github.com/DGATX/jellydown.git
cd jellydown/web

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

For development with hot reload:

```bash
npm run dev
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `6942` | Server port |
| `NODE_ENV` | `development` | Environment (`development` or `production`) |
| `SESSION_SECRET` | (random) | Secret for session encryption (set in production!) |
| `DOWNLOADS_DIR` | `./downloads` | Directory for completed downloads |
| `TEMP_DIR` | `./temp` | Directory for temporary files and segments |
| `DATA_DIR` | `./data` | Directory for settings and data persistence |
| `MAX_CONCURRENT_SEGMENTS` | `3` | Segments downloaded in parallel per file |
| `MAX_RETRIES` | `5` | Retry attempts per segment |
| `SEGMENT_TIMEOUT_MS` | `120000` | Timeout per segment (2 minutes) |
| `SESSION_MAX_AGE_MS` | `86400000` | Session duration (24 hours) |
| `TRUST_PROXY` | `true` | Trust reverse proxy headers (`true`, `false`, or hop count) |

### Docker Environment Example

```yaml
services:
  jellydown:
    image: dgatx/jellydown:latest
    ports:
      - "6942:6942"
    environment:
      - NODE_ENV=production
      - SESSION_SECRET=your-secure-secret-here
      - MAX_CONCURRENT_SEGMENTS=5
    volumes:
      - ./downloads:/app/downloads
      - ./data:/app/data
      - ./temp:/app/temp
    restart: unless-stopped
```

## Usage

### Getting Started

1. Open JellyDown in your browser
2. Enter your Jellyfin server URL (e.g., `http://jellyfin.local:8096`)
3. Login with your Jellyfin credentials
4. Browse your library and select videos to download
5. Choose a quality preset and start downloading

### Quality Presets

| Preset | Resolution | Video Bitrate | Audio Bitrate |
|--------|------------|---------------|---------------|
| Low | 854p | 1 Mbps | 128 kbps |
| Medium | 1280p | 2.5 Mbps | 192 kbps |
| High | 1920p | 5 Mbps | 256 kbps |
| Very High | 1920p | 8 Mbps | 320 kbps |

You can also create custom presets in Settings with your own resolution, bitrate, and codec choices.

### Batch Downloads

1. Navigate to a TV series
2. Click "Select Episodes" to enter batch mode
3. Select individual episodes or use "Select All"
4. Click "Download Selected" to queue all selected episodes

### File Retention

Configure automatic cleanup of downloaded files:

- **Global Default**: Set in Settings (Forever or 1-365 days)
- **Per-File Override**: Edit retention for individual files in the Completed tab

## Reverse Proxy Setup

JellyDown works behind reverse proxies with WebSocket support.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name jellydown.example.com;

    location / {
        proxy_pass http://127.0.0.1:6942;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable buffering for large file downloads
        proxy_buffering off;
        proxy_request_buffering off;

        # Increase timeouts for long downloads
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Nginx Proxy Manager

1. Add a new Proxy Host
2. Set the Forward Hostname/IP and Port (6942)
3. Enable "Websockets Support"
4. Add SSL certificate if desired

### Traefik

```yaml
# docker-compose.yml with Traefik labels
services:
  jellydown:
    image: dgatx/jellydown:latest
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.jellydown.rule=Host(`jellydown.example.com`)"
      - "traefik.http.routers.jellydown.entrypoints=websecure"
      - "traefik.http.routers.jellydown.tls.certresolver=letsencrypt"
      - "traefik.http.services.jellydown.loadbalancer.server.port=6942"
    volumes:
      - ./downloads:/app/downloads
      - ./data:/app/data
      - ./temp:/app/temp
```

### Caddy

```
jellydown.example.com {
    reverse_proxy localhost:6942
}
```

Caddy automatically handles WebSocket upgrades and HTTPS.

## Development

### Project Structure

```
web/
├── client/           # Frontend (vanilla JS SPA)
│   ├── index.html
│   ├── js/
│   │   ├── app.js      # Main UI logic
│   │   ├── api.js      # REST client
│   │   └── download.js # Download manager & WebSocket
│   └── css/
├── server/           # Backend (Express + TypeScript)
│   ├── index.ts        # Entry point
│   ├── config.ts       # Configuration
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   ├── middleware/     # Auth, error handling
│   └── websocket/      # Real-time progress
├── downloads/        # Completed files
├── temp/             # Segment cache
└── data/             # Settings persistence
```

### Running Tests

```bash
cd web
npm test
```

### Building

```bash
npm run build
```

## API Overview

JellyDown exposes a REST API for all operations:

- `POST /api/auth/connect` - Test Jellyfin server connection
- `POST /api/auth/login` - Authenticate with Jellyfin
- `GET /api/library/views` - Get library views
- `GET /api/library/items` - Browse library items
- `POST /api/download/start` - Start a download
- `GET /api/download/list` - Get download queue
- `DELETE /api/download/:id` - Cancel a download
- `GET /api/settings` - Get app settings
- `PUT /api/settings` - Update app settings

WebSocket endpoint at `/ws` for real-time progress updates.

## Troubleshooting

### Downloads fail immediately

- Check that your Jellyfin server allows transcoding
- Verify your Jellyfin user has permission to access the content
- Check the browser console and server logs for errors

### WebSocket disconnects

- If behind a reverse proxy, ensure WebSocket support is enabled
- Check proxy timeout settings (should be > 60 seconds)

### Slow downloads

- Jellyfin transcodes in real-time, speed depends on server hardware
- Try a lower quality preset
- Check Jellyfin server CPU usage during transcoding

### Files not appearing in Completed

- Check the `downloads` directory permissions
- Ensure ffmpeg is installed and accessible

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Jellyfin](https://jellyfin.org/) - The free software media system
- [ffmpeg](https://ffmpeg.org/) - For video processing
