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

vi.mock('../../index', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../config', () => ({
  config: {
    tempDir: '/tmp/test-temp',
    downloadsDir: '/tmp/test-downloads'
  }
}));

vi.mock('../../services/jellyfin.service', () => ({
  createJellyfinService: vi.fn()
}));

vi.mock('../../services/download.service', () => ({
  downloadService: {
    getAllDownloads: vi.fn(),
    startDownload: vi.fn(),
    cancelDownload: vi.fn(),
    removeDownload: vi.fn(),
    resumeDownload: vi.fn(),
    pauseDownload: vi.fn(),
    resumePausedDownload: vi.fn(),
    moveToFront: vi.fn(),
    reorderQueue: vi.fn(),
    getQueueInfo: vi.fn(),
    getProgress: vi.fn(),
    streamToResponse: vi.fn(),
    cancelByItemIds: vi.fn(),
    pauseAllQueued: vi.fn(),
    resumeAllPaused: vi.fn(),
    clearCompleted: vi.fn()
  }
}));

vi.mock('../../services/settings.service', () => ({
  settingsService: {
    get: vi.fn()
  }
}));

vi.mock('fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    stat: vi.fn(),
    rm: vi.fn()
  }
}));

vi.mock('child_process', () => ({
  exec: vi.fn()
}));

import downloadRoutes from '../../routes/download.routes';
import { createJellyfinService } from '../../services/jellyfin.service';
import { downloadService } from '../../services/download.service';
import { settingsService } from '../../services/settings.service';
import fsp from 'fs/promises';

describe('Download Routes', () => {
  let app: Express;
  let mockJellyfinService: any;

  const defaultPresets = [
    { id: 'low', name: 'Low', maxWidth: 854, maxBitrate: 1_000_000, videoCodec: 'h264', audioCodec: 'aac', audioBitrate: 128_000, audioChannels: 2 },
    { id: 'medium', name: 'Medium', maxWidth: 1280, maxBitrate: 2_500_000, videoCodec: 'h264', audioCodec: 'aac', audioBitrate: 192_000, audioChannels: 2 },
    { id: 'high', name: 'High', maxWidth: 1920, maxBitrate: 5_000_000, videoCodec: 'h264', audioCodec: 'aac', audioBitrate: 256_000, audioChannels: 2 },
    { id: 'veryHigh', name: 'Very High', maxWidth: 1920, maxBitrate: 8_000_000, videoCodec: 'h264', audioCodec: 'aac', audioBitrate: 320_000, audioChannels: 6 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockJellyfinService = {
      getItem: vi.fn(),
      buildHLSUrl: vi.fn().mockReturnValue('http://jellyfin.local/hls/test.m3u8')
    };

    vi.mocked(createJellyfinService).mockReturnValue(mockJellyfinService);
    vi.mocked(settingsService.get).mockImplementation((key: string) => {
      if (key === 'presets') return defaultPresets;
      if (key === 'downloadsDir') return '/tmp/test-downloads';
      return undefined;
    });

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

    app.use('/api/download', downloadRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/download/list', () => {
    it('should return all downloads', async () => {
      const mockDownloads = [
        { id: 'session-1', title: 'Test Movie', status: 'transcoding' },
        { id: 'session-2', title: 'Another Movie', status: 'completed' }
      ];
      vi.mocked(downloadService.getAllDownloads).mockReturnValue(mockDownloads);

      const res = await request(app)
        .get('/api/download/list');

      expect(res.status).toBe(200);
      expect(res.body.downloads).toHaveLength(2);
    });

    it('should return empty array when no downloads', async () => {
      vi.mocked(downloadService.getAllDownloads).mockReturnValue([]);

      const res = await request(app)
        .get('/api/download/list');

      expect(res.status).toBe(200);
      expect(res.body.downloads).toEqual([]);
    });
  });

  describe('GET /api/download/presets', () => {
    it('should return formatted presets', async () => {
      const res = await request(app)
        .get('/api/download/presets');

      expect(res.status).toBe(200);
      expect(res.body.presets).toHaveLength(4);
      expect(res.body.presets[0].id).toBe('low');
      expect(res.body.presets[0].resolution).toBe('480p');
      expect(res.body.presets[0].bitrateFormatted).toBe('1.0 Mbps');
    });

    it('should include description for each preset', async () => {
      const res = await request(app)
        .get('/api/download/presets');

      expect(res.body.presets[0].description).toBe('Best for mobile data saving');
      expect(res.body.presets[1].description).toBe('Good balance of quality & size');
      expect(res.body.presets[2].description).toBe('High quality for larger screens');
      expect(res.body.presets[3].description).toBe('High quality for larger screens');
    });

    it('should calculate estimated size per hour', async () => {
      const res = await request(app)
        .get('/api/download/presets');

      // Low preset: (1,000,000 + 128,000) * 3600 / 8 / 1,000,000 = ~507 MB/hr
      expect(res.body.presets[0].sizePerHourFormatted).toContain('MB/hr');
    });
  });

  describe('POST /api/download/start', () => {
    it('should return 400 when itemId is missing', async () => {
      const res = await request(app)
        .post('/api/download/start')
        .send({ preset: 'high' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toBe('itemId and preset are required');
    });

    it('should return 400 when preset is missing', async () => {
      const res = await request(app)
        .post('/api/download/start')
        .send({ itemId: 'item-123' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('itemId and preset are required');
    });

    it('should return 400 for invalid preset', async () => {
      const res = await request(app)
        .post('/api/download/start')
        .send({ itemId: 'item-123', preset: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid preset: invalid');
    });

    it('should start download successfully', async () => {
      const mockItem = {
        Name: 'Test Movie',
        MediaSources: [{ Id: 'source-1' }],
        RunTimeTicks: 72000000000
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);

      const mockSession = {
        id: 'session-123',
        filename: 'Test Movie.mp4'
      };
      vi.mocked(downloadService.startDownload).mockResolvedValue(mockSession as any);

      const res = await request(app)
        .post('/api/download/start')
        .send({ itemId: 'item-123', preset: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('session-123');
      expect(res.body.filename).toBe('Test Movie.mp4');
      expect(res.body.estimatedSize).toBeDefined();
      expect(res.body.estimatedSizeFormatted).toBeDefined();
    });

    it('should return 400 when item has no media sources', async () => {
      mockJellyfinService.getItem.mockResolvedValue({
        Name: 'Test Movie',
        MediaSources: []
      });

      const res = await request(app)
        .post('/api/download/start')
        .send({ itemId: 'item-123', preset: 'high' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('No media sources available for this item');
    });

    it('should handle TV episode title formatting', async () => {
      const mockItem = {
        Name: 'Pilot',
        SeriesName: 'Test Show',
        ParentIndexNumber: 1,
        IndexNumber: 1,
        MediaSources: [{ Id: 'source-1' }],
        RunTimeTicks: 27000000000
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);
      vi.mocked(downloadService.startDownload).mockResolvedValue({
        id: 'session-123',
        filename: 'Test Show - S01E01 - Pilot.mp4'
      } as any);

      const res = await request(app)
        .post('/api/download/start')
        .send({ itemId: 'episode-123', preset: 'high' });

      expect(res.status).toBe(200);
      expect(downloadService.startDownload).toHaveBeenCalledWith(
        'episode-123',
        'source-1',
        'Test Show - S01E01 - Pilot',
        expect.any(String),
        expect.any(Number),
        expect.any(Object),
        undefined
      );
    });

    it('should handle soft subtitles', async () => {
      const mockItem = {
        Name: 'Test Movie',
        MediaSources: [{
          Id: 'source-1',
          MediaStreams: [
            { Index: 3, Type: 'Subtitle', Language: 'eng', Codec: 'srt' }
          ]
        }],
        RunTimeTicks: 72000000000
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);
      vi.mocked(downloadService.startDownload).mockResolvedValue({
        id: 'session-123',
        filename: 'Test Movie.mp4'
      } as any);

      const res = await request(app)
        .post('/api/download/start')
        .send({
          itemId: 'item-123',
          preset: 'high',
          subtitleStreamIndex: 3,
          subtitleMethod: 'soft'
        });

      expect(res.status).toBe(200);
      expect(downloadService.startDownload).toHaveBeenCalledWith(
        'item-123',
        'source-1',
        'Test Movie',
        expect.any(String),
        expect.any(Number),
        expect.any(Object),
        expect.objectContaining({
          streamIndex: 3,
          language: 'eng',
          codec: 'srt'
        })
      );
    });
  });

  describe('POST /api/download/batch', () => {
    it('should return 400 when items is missing', async () => {
      const res = await request(app)
        .post('/api/download/batch')
        .send({ preset: 'high' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('items array is required');
    });

    it('should return 400 when items is empty', async () => {
      const res = await request(app)
        .post('/api/download/batch')
        .send({ items: [], preset: 'high' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when preset is missing', async () => {
      const res = await request(app)
        .post('/api/download/batch')
        .send({ items: [{ itemId: 'item-1' }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('preset is required');
    });

    it('should start batch downloads successfully', async () => {
      mockJellyfinService.getItem
        .mockResolvedValueOnce({
          Name: 'Movie 1',
          MediaSources: [{ Id: 'source-1' }],
          RunTimeTicks: 72000000000
        })
        .mockResolvedValueOnce({
          Name: 'Movie 2',
          MediaSources: [{ Id: 'source-2' }],
          RunTimeTicks: 72000000000
        });

      vi.mocked(downloadService.startDownload)
        .mockResolvedValueOnce({ id: 'session-1', filename: 'Movie 1.mp4' } as any)
        .mockResolvedValueOnce({ id: 'session-2', filename: 'Movie 2.mp4' } as any);

      const res = await request(app)
        .post('/api/download/batch')
        .send({
          items: [{ itemId: 'item-1' }, { itemId: 'item-2' }],
          preset: 'high'
        });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0].success).toBe(true);
      expect(res.body.results[1].success).toBe(true);
    });

    it('should handle partial failures in batch', async () => {
      mockJellyfinService.getItem
        .mockResolvedValueOnce({
          Name: 'Movie 1',
          MediaSources: [{ Id: 'source-1' }],
          RunTimeTicks: 72000000000
        })
        .mockResolvedValueOnce({
          Name: 'Movie 2',
          MediaSources: [] // No media sources
        });

      vi.mocked(downloadService.startDownload)
        .mockResolvedValueOnce({ id: 'session-1', filename: 'Movie 1.mp4' } as any);

      const res = await request(app)
        .post('/api/download/batch')
        .send({
          items: [{ itemId: 'item-1' }, { itemId: 'item-2' }],
          preset: 'high'
        });

      expect(res.status).toBe(200);
      expect(res.body.results[0].success).toBe(true);
      expect(res.body.results[1].success).toBe(false);
      expect(res.body.results[1].error).toBe('No media sources available');
    });
  });

  describe('DELETE /api/download/batch', () => {
    it('should return 400 when itemIds is missing', async () => {
      const res = await request(app)
        .delete('/api/download/batch')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('itemIds array is required');
    });

    it('should cancel batch downloads successfully', async () => {
      vi.mocked(downloadService.cancelByItemIds).mockResolvedValue({
        cancelled: 2,
        removed: 1
      });

      const res = await request(app)
        .delete('/api/download/batch')
        .send({ itemIds: ['item-1', 'item-2', 'item-3'] });

      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(2);
      expect(res.body.removed).toBe(1);
    });
  });

  describe('GET /api/download/progress/:sessionId', () => {
    it('should return progress for existing session', async () => {
      const mockProgress = {
        sessionId: 'session-123',
        status: 'transcoding',
        progress: 50,
        completedSegments: 25,
        totalSegments: 50
      };
      vi.mocked(downloadService.getProgress).mockReturnValue(mockProgress);

      const res = await request(app)
        .get('/api/download/progress/session-123');

      expect(res.status).toBe(200);
      expect(res.body.progress).toBe(50);
    });

    it('should return 404 for non-existent session', async () => {
      vi.mocked(downloadService.getProgress).mockReturnValue(undefined);

      const res = await request(app)
        .get('/api/download/progress/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });
  });

  describe('DELETE /api/download/:sessionId', () => {
    it('should cancel download', async () => {
      vi.mocked(downloadService.cancelDownload).mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/download/session-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(downloadService.cancelDownload).toHaveBeenCalledWith('session-123');
    });
  });

  describe('DELETE /api/download/:sessionId/remove', () => {
    it('should remove download from list', async () => {
      vi.mocked(downloadService.removeDownload).mockResolvedValue(true);

      const res = await request(app)
        .delete('/api/download/session-123/remove');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 when cannot remove active download', async () => {
      vi.mocked(downloadService.removeDownload).mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/download/session-123/remove');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Cannot remove active downloads. Cancel first.');
    });
  });

  describe('POST /api/download/:sessionId/resume', () => {
    it('should resume failed download', async () => {
      const mockSession = {
        id: 'session-123',
        status: 'transcoding',
        completedSegments: 25,
        totalSegments: 50
      };
      vi.mocked(downloadService.resumeDownload).mockResolvedValue(mockSession as any);

      const res = await request(app)
        .post('/api/download/session-123/resume');

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('session-123');
      expect(res.body.message).toContain('25/50 segments already completed');
    });
  });

  describe('POST /api/download/:sessionId/pause', () => {
    it('should pause queued download', async () => {
      vi.mocked(downloadService.pauseDownload).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/download/session-123/pause');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/download/:sessionId/unpause', () => {
    it('should unpause download', async () => {
      vi.mocked(downloadService.resumePausedDownload).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/download/session-123/unpause');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/download/:sessionId/move-to-front', () => {
    it('should move download to front of queue', async () => {
      vi.mocked(downloadService.moveToFront).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/download/session-123/move-to-front');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('PUT /api/download/:sessionId/position', () => {
    it('should reorder download in queue', async () => {
      vi.mocked(downloadService.reorderQueue).mockResolvedValue(undefined);

      const res = await request(app)
        .put('/api/download/session-123/position')
        .send({ position: 2 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(downloadService.reorderQueue).toHaveBeenCalledWith('session-123', 2);
    });

    it('should return 400 for invalid position', async () => {
      const res = await request(app)
        .put('/api/download/session-123/position')
        .send({ position: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid position');
    });

    it('should return 400 for non-number position', async () => {
      const res = await request(app)
        .put('/api/download/session-123/position')
        .send({ position: 'first' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/download/queue/info', () => {
    it('should return queue information', async () => {
      const mockInfo = {
        activeCount: 2,
        queuedCount: 5,
        maxConcurrent: 5
      };
      vi.mocked(downloadService.getQueueInfo).mockReturnValue(mockInfo);

      const res = await request(app)
        .get('/api/download/queue/info');

      expect(res.status).toBe(200);
      expect(res.body.activeCount).toBe(2);
      expect(res.body.queuedCount).toBe(5);
    });
  });

  describe('POST /api/download/queue/pause-all', () => {
    it('should pause all queued downloads', async () => {
      vi.mocked(downloadService.pauseAllQueued).mockReturnValue({ paused: 3 });

      const res = await request(app)
        .post('/api/download/queue/pause-all');

      expect(res.status).toBe(200);
      expect(res.body.paused).toBe(3);
    });
  });

  describe('POST /api/download/queue/resume-all', () => {
    it('should resume all paused downloads', async () => {
      vi.mocked(downloadService.resumeAllPaused).mockReturnValue({ resumed: 3 });

      const res = await request(app)
        .post('/api/download/queue/resume-all');

      expect(res.status).toBe(200);
      expect(res.body.resumed).toBe(3);
    });
  });

  describe('DELETE /api/download/queue/clear-completed', () => {
    it('should clear completed downloads', async () => {
      vi.mocked(downloadService.clearCompleted).mockResolvedValue({ cleared: 5 });

      const res = await request(app)
        .delete('/api/download/queue/clear-completed');

      expect(res.status).toBe(200);
      expect(res.body.cleared).toBe(5);
    });
  });

  describe('GET /api/download/cache', () => {
    it('should return empty array when no downloads', async () => {
      vi.mocked(fsp.readdir).mockResolvedValue([]);

      const res = await request(app)
        .get('/api/download/cache');

      expect(res.status).toBe(200);
      expect(res.body.cached).toEqual([]);
    });

    it('should handle non-existent downloads directory', async () => {
      vi.mocked(fsp.readdir).mockRejectedValue(new Error('ENOENT'));

      const res = await request(app)
        .get('/api/download/cache');

      expect(res.status).toBe(200);
      expect(res.body.cached).toEqual([]);
    });
  });

  describe('DELETE /api/download/cache/:id', () => {
    it('should delete cached file', async () => {
      vi.mocked(fsp.rm).mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/download/cache/download-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should prevent path traversal attacks', async () => {
      // URL-encode the path traversal to bypass express URL normalization
      // This ensures the path traversal string reaches the route handler
      const res = await request(app)
        .delete('/api/download/cache/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Invalid path');
    });
  });
});
