import express from 'express';
import session from 'express-session';
import FileStoreFactory from 'session-file-store';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { createServer } from 'http';
import winston from 'winston';

import { config } from './config';
import { errorHandler } from './middleware/error.middleware';
import { setupWebSocket } from './websocket/progress';
import { downloadService } from './services/download.service';

const FileStore = FileStoreFactory(session);

import authRoutes from './routes/auth.routes';
import libraryRoutes from './routes/library.routes';
import downloadRoutes from './routes/download.routes';
import settingsRoutes from './routes/settings.routes';
import { settingsService } from './services/settings.service';

// Logger setup - exported for use in other modules
export const logger = winston.createLogger({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Create Express app
const app = express();
const server = createServer(app);

// Trust proxy configuration for reverse proxies (nginx, traefik, caddy, etc.)
// Parses X-Forwarded-* headers for proper client IP, protocol detection
const trustProxySetting = config.trustProxy;
if (trustProxySetting === 'true') {
  app.set('trust proxy', true);
} else if (trustProxySetting === 'false') {
  app.set('trust proxy', false);
} else {
  // Numeric value for number of proxy hops
  app.set('trust proxy', parseInt(trustProxySetting, 10) || true);
}

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'development' ? true : undefined,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Session configuration with file-based store for persistence across restarts
const sessionDir = path.join(config.tempDir, 'sessions');
app.use(session({
  store: new FileStore({
    path: sessionDir,
    ttl: config.sessionMaxAgeMs / 1000, // TTL in seconds
    retries: 0,
    logFn: () => {} // Silence file-store logs
  }),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Use req.secure which respects X-Forwarded-Proto when trust proxy is enabled
    secure: 'auto',
    httpOnly: true,
    maxAge: config.sessionMaxAgeMs,
    sameSite: 'lax'
  },
  // Dynamically set secure cookie based on request protocol (handles reverse proxy HTTPS termination)
  proxy: true
}));

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '..', 'client')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: config.appVersion });
});

// Restart server endpoint
app.post('/api/restart', (_req, res) => {
  logger.info('Server restart requested');
  res.json({ status: 'restarting', message: 'Server is restarting...' });

  // Give time for response to be sent, then exit
  // The process manager (pm2, systemd, or manual restart) should bring it back
  setTimeout(() => {
    logger.info('Shutting down for restart...');
    process.exit(0);
  }, 500);
});

// Serve index.html for all other routes (SPA)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Error handler
app.use(errorHandler);

// Setup WebSocket
setupWebSocket(server);

// Initialize services and start server
(async () => {
  try {
    // Initialize download service (loads settings and starts cleanup interval)
    await downloadService.initialize();
    logger.info(`Settings loaded (maxConcurrentDownloads: ${settingsService.get('maxConcurrentDownloads')})`);
  } catch (err) {
    logger.warn('Failed to initialize services, using defaults');
  }

  server.listen(config.port, () => {
    logger.info(`Jellyfin Web Downloader running on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    if (config.nodeEnv === 'development') {
      logger.info(`Open http://localhost:${config.port} in your browser`);
    }
  });
})();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  downloadService.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  downloadService.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
