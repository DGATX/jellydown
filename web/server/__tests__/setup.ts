// Test setup file
import { vi } from 'vitest';

// Mock winston logger to avoid console output during tests
vi.mock('../index', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock config with test values
vi.mock('../config', () => ({
  config: {
    port: 6942,
    nodeEnv: 'test',
    sessionSecret: 'test-secret',
    tempDir: '/tmp/jellyfin-test/temp',
    downloadsDir: '/tmp/jellyfin-test/downloads',
    dataDir: '/tmp/jellyfin-test/data',
    maxConcurrentSegments: 3,
    maxRetries: 5,
    segmentTimeoutMs: 30000,
    sessionMaxAgeMs: 86400000,
    appName: 'JellyfinWebDownloader',
    appVersion: '1.0.0',
  },
}));
