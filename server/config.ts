import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '6942', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'jellyfin-web-downloader-secret-change-me',
  tempDir: process.env.TEMP_DIR || path.join(__dirname, '..', 'temp'),
  downloadsDir: process.env.DOWNLOADS_DIR || path.join(__dirname, '..', 'downloads'),
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // Download settings
  maxConcurrentSegments: parseInt(process.env.MAX_CONCURRENT_SEGMENTS || '3', 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || '5', 10),
  segmentTimeoutMs: parseInt(process.env.SEGMENT_TIMEOUT_MS || '120000', 10), // 2 minutes for slow transcoding

  // Session settings
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10), // 24 hours

  // App info for Jellyfin auth header
  appName: 'JellyfinWebDownloader',
  appVersion: '1.0.0'
};
