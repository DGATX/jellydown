import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Note: The config module uses dotenv.config() which loads from .env file
// So "defaults" are actually the .env values when .env exists

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // Create a clean env without the dotenv-loaded values
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('environment variable overrides', () => {
    it('should use PORT from environment', async () => {
      process.env.PORT = '8080';
      const { config } = await import('../config');
      expect(config.port).toBe(8080);
    });

    it('should use NODE_ENV from environment', async () => {
      process.env.NODE_ENV = 'production';
      const { config } = await import('../config');
      expect(config.nodeEnv).toBe('production');
    });

    it('should use SESSION_SECRET from environment', async () => {
      process.env.SESSION_SECRET = 'my-super-secret';
      const { config } = await import('../config');
      expect(config.sessionSecret).toBe('my-super-secret');
    });

    it('should use TEMP_DIR from environment', async () => {
      process.env.TEMP_DIR = '/custom/temp';
      const { config } = await import('../config');
      expect(config.tempDir).toBe('/custom/temp');
    });

    it('should use DOWNLOADS_DIR from environment', async () => {
      process.env.DOWNLOADS_DIR = '/custom/downloads';
      const { config } = await import('../config');
      expect(config.downloadsDir).toBe('/custom/downloads');
    });

    it('should use DATA_DIR from environment', async () => {
      process.env.DATA_DIR = '/custom/data';
      const { config } = await import('../config');
      expect(config.dataDir).toBe('/custom/data');
    });

    it('should use MAX_CONCURRENT_SEGMENTS from environment', async () => {
      process.env.MAX_CONCURRENT_SEGMENTS = '5';
      const { config } = await import('../config');
      expect(config.maxConcurrentSegments).toBe(5);
    });

    it('should use MAX_RETRIES from environment', async () => {
      process.env.MAX_RETRIES = '10';
      const { config } = await import('../config');
      expect(config.maxRetries).toBe(10);
    });

    it('should use SEGMENT_TIMEOUT_MS from environment', async () => {
      process.env.SEGMENT_TIMEOUT_MS = '60000';
      const { config } = await import('../config');
      expect(config.segmentTimeoutMs).toBe(60000);
    });

    it('should use SESSION_MAX_AGE_MS from environment', async () => {
      process.env.SESSION_MAX_AGE_MS = '3600000';
      const { config } = await import('../config');
      expect(config.sessionMaxAgeMs).toBe(3600000);
    });
  });

  describe('type coercion', () => {
    it('should parse PORT as integer', async () => {
      process.env.PORT = '3000';
      const { config } = await import('../config');
      expect(typeof config.port).toBe('number');
      expect(config.port).toBe(3000);
    });

    it('should parse MAX_CONCURRENT_SEGMENTS as integer', async () => {
      process.env.MAX_CONCURRENT_SEGMENTS = '10';
      const { config } = await import('../config');
      expect(typeof config.maxConcurrentSegments).toBe('number');
      expect(config.maxConcurrentSegments).toBe(10);
    });

    it('should parse MAX_RETRIES as integer', async () => {
      process.env.MAX_RETRIES = '8';
      const { config } = await import('../config');
      expect(typeof config.maxRetries).toBe('number');
      expect(config.maxRetries).toBe(8);
    });

    it('should parse SEGMENT_TIMEOUT_MS as integer', async () => {
      process.env.SEGMENT_TIMEOUT_MS = '180000';
      const { config } = await import('../config');
      expect(typeof config.segmentTimeoutMs).toBe('number');
      expect(config.segmentTimeoutMs).toBe(180000);
    });

    it('should parse SESSION_MAX_AGE_MS as integer', async () => {
      process.env.SESSION_MAX_AGE_MS = '7200000';
      const { config } = await import('../config');
      expect(typeof config.sessionMaxAgeMs).toBe('number');
      expect(config.sessionMaxAgeMs).toBe(7200000);
    });

    it('should handle invalid PORT gracefully', async () => {
      process.env.PORT = 'invalid';
      const { config } = await import('../config');
      expect(config.port).toBeNaN();
    });
  });

  describe('static values', () => {
    it('should have correct app name', async () => {
      const { config } = await import('../config');
      expect(config.appName).toBe('JellyfinWebDownloader');
    });

    it('should have correct app version', async () => {
      const { config } = await import('../config');
      expect(config.appVersion).toBe('1.0.0');
    });
  });

  describe('directory paths', () => {
    it('should have tempDir defined', async () => {
      const { config } = await import('../config');
      expect(config.tempDir).toBeDefined();
      expect(typeof config.tempDir).toBe('string');
    });

    it('should have downloadsDir defined', async () => {
      const { config } = await import('../config');
      expect(config.downloadsDir).toBeDefined();
      expect(typeof config.downloadsDir).toBe('string');
    });

    it('should have dataDir defined', async () => {
      const { config } = await import('../config');
      expect(config.dataDir).toBeDefined();
      expect(typeof config.dataDir).toBe('string');
    });
  });

  describe('config loading with .env', () => {
    it('should load PORT from .env when available', async () => {
      // Default port from .env or config is 6942
      const { config } = await import('../config');
      expect(config.port).toBe(6942);
    });

    it('should load maxConcurrentSegments from config', async () => {
      const { config } = await import('../config');
      expect(config.maxConcurrentSegments).toBe(3);
    });

    it('should have sessionMaxAgeMs set to 24 hours', async () => {
      const { config } = await import('../config');
      expect(config.sessionMaxAgeMs).toBe(86400000);
    });
  });
});
