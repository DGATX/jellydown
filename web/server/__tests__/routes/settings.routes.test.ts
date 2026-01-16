import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import session from 'express-session';

// Mock dependencies
vi.mock('../../middleware/auth.middleware', () => ({
  requireAuth: vi.fn((req, res, next) => {
    if (req.session?.jellyfin?.accessToken) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  })
}));

vi.mock('../../services/settings.service', () => ({
  settingsService: {
    getAll: vi.fn(),
    update: vi.fn()
  }
}));

import settingsRoutes from '../../routes/settings.routes';
import { settingsService } from '../../services/settings.service';

describe('Settings Routes', () => {
  let app: Express;

  const defaultSettings = {
    maxConcurrentDownloads: 5,
    downloadsDir: '/downloads',
    presets: [
      { id: 'low', name: 'Low', maxWidth: 854, maxBitrate: 1_000_000 },
      { id: 'medium', name: 'Medium', maxWidth: 1280, maxBitrate: 2_500_000 },
      { id: 'high', name: 'High', maxWidth: 1920, maxBitrate: 5_000_000 },
      { id: 'veryHigh', name: 'Very High', maxWidth: 1920, maxBitrate: 8_000_000 }
    ],
    savedServers: []
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(settingsService.getAll).mockReturnValue(defaultSettings);

    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false
    }));

    // Simulate authenticated session
    app.use((req, _res, next) => {
      req.session.jellyfin = {
        accessToken: 'test-token',
        serverUrl: 'http://jellyfin.local',
        userId: 'user-123',
        serverId: 'server-123',
        deviceId: 'device-123',
        username: 'testuser'
      };
      next();
    });

    app.use('/api/settings', settingsRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/settings', () => {
    it('should return all settings', async () => {
      const res = await request(app)
        .get('/api/settings');

      expect(res.status).toBe(200);
      expect(res.body.maxConcurrentDownloads).toBe(5);
      expect(res.body.presets).toHaveLength(4);
    });

    it('should require authentication', async () => {
      // Create app without auth session
      const unauthApp = express();
      unauthApp.use(express.json());
      unauthApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false
      }));
      unauthApp.use('/api/settings', settingsRoutes);

      const res = await request(unauthApp)
        .get('/api/settings');

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/settings', () => {
    it('should update settings successfully', async () => {
      const newSettings = { ...defaultSettings, maxConcurrentDownloads: 10 };
      vi.mocked(settingsService.update).mockResolvedValue(undefined);
      vi.mocked(settingsService.getAll).mockReturnValue(newSettings);

      const res = await request(app)
        .put('/api/settings')
        .send({ maxConcurrentDownloads: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.settings.maxConcurrentDownloads).toBe(10);
      expect(settingsService.update).toHaveBeenCalledWith({ maxConcurrentDownloads: 10 });
    });

    it('should return 400 for invalid maxConcurrentDownloads', async () => {
      vi.mocked(settingsService.update).mockRejectedValue(
        new Error('maxConcurrentDownloads must be between 1 and 20')
      );

      const res = await request(app)
        .put('/api/settings')
        .send({ maxConcurrentDownloads: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be between');
    });

    it('should return 400 for invalid presets', async () => {
      vi.mocked(settingsService.update).mockRejectedValue(
        new Error('maxWidth must be between 320 and 7680')
      );

      const res = await request(app)
        .put('/api/settings')
        .send({
          presets: [
            { id: 'invalid', name: 'Invalid', maxWidth: 100 }
          ]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be between');
    });

    it('should return 400 for invalid downloadsDir', async () => {
      vi.mocked(settingsService.update).mockRejectedValue(
        new Error('downloadsDir must be between')
      );

      const res = await request(app)
        .put('/api/settings')
        .send({ downloadsDir: '' });

      expect(res.status).toBe(400);
    });

    it('should handle non-validation errors as 500', async () => {
      vi.mocked(settingsService.update).mockRejectedValue(
        new Error('File system error')
      );

      const res = await request(app)
        .put('/api/settings')
        .send({ maxConcurrentDownloads: 10 });

      expect(res.status).toBe(500);
    });

    it('should update multiple settings at once', async () => {
      const updatedSettings = {
        ...defaultSettings,
        maxConcurrentDownloads: 8,
        downloadsDir: '/new-downloads'
      };
      vi.mocked(settingsService.update).mockResolvedValue(undefined);
      vi.mocked(settingsService.getAll).mockReturnValue(updatedSettings);

      const res = await request(app)
        .put('/api/settings')
        .send({
          maxConcurrentDownloads: 8,
          downloadsDir: '/new-downloads'
        });

      expect(res.status).toBe(200);
      expect(res.body.settings.maxConcurrentDownloads).toBe(8);
      expect(res.body.settings.downloadsDir).toBe('/new-downloads');
    });

    it('should update presets', async () => {
      const newPresets = [
        { id: 'custom', name: 'Custom', maxWidth: 1920, maxBitrate: 10_000_000, videoCodec: 'hevc', audioCodec: 'aac', audioBitrate: 256_000, audioChannels: 6 }
      ];
      const updatedSettings = { ...defaultSettings, presets: newPresets };
      vi.mocked(settingsService.update).mockResolvedValue(undefined);
      vi.mocked(settingsService.getAll).mockReturnValue(updatedSettings);

      const res = await request(app)
        .put('/api/settings')
        .send({ presets: newPresets });

      expect(res.status).toBe(200);
      expect(res.body.settings.presets).toHaveLength(1);
      expect(res.body.settings.presets[0].id).toBe('custom');
    });

    it('should require authentication', async () => {
      const unauthApp = express();
      unauthApp.use(express.json());
      unauthApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false
      }));
      unauthApp.use('/api/settings', settingsRoutes);

      const res = await request(unauthApp)
        .put('/api/settings')
        .send({ maxConcurrentDownloads: 10 });

      expect(res.status).toBe(401);
    });
  });
});
