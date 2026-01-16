import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Setup mocks before importing the service
vi.mock('../../index', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  config: {
    tempDir: '/tmp/test-temp',
    dataDir: '/tmp/test-data',
    downloadsDir: '/tmp/test-downloads',
  },
}));

vi.mock('../../services/settings.service', () => ({
  settingsService: {
    load: vi.fn().mockResolvedValue(undefined),
    get: vi.fn((key: string) => {
      if (key === 'maxConcurrentDownloads') return 5;
      if (key === 'downloadsDir') return '/tmp/test-downloads';
      return undefined;
    }),
  },
}));

vi.mock('../../services/hls-parser.service', () => ({
  hlsParser: {
    parseMasterPlaylist: vi.fn(),
    parseMediaPlaylist: vi.fn(),
  },
}));

vi.mock('../../services/segment.service', () => ({
  segmentService: {
    downloadSegments: vi.fn(),
    concatenateWithFfmpeg: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    rm: vi.fn(),
  },
}));

import { DownloadService } from '../../services/download.service';
import { TranscodeSettings } from '../../models/types';

describe('DownloadService', () => {
  let service: DownloadService;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new DownloadService();
    await service.initialize();
  });

  afterEach(() => {
    service.shutdown();
  });

  describe('initialize', () => {
    it('should load settings on initialization', async () => {
      const { settingsService } = await import('../../services/settings.service');
      expect(settingsService.load).toHaveBeenCalled();
    });

    it('should only initialize once', async () => {
      const { settingsService } = await import('../../services/settings.service');
      vi.clearAllMocks();

      await service.initialize();
      await service.initialize();

      // Should not call load again since already initialized
      expect(settingsService.load).not.toHaveBeenCalled();
    });
  });

  describe('validateTranscodeSettings', () => {
    const validSettings: TranscodeSettings = {
      maxWidth: 1920,
      maxBitrate: 5_000_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 256_000,
      audioChannels: 2,
    };

    it('should reject null settings', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          null as any
        )
      ).rejects.toThrow('transcodeSettings is required');
    });

    it('should reject undefined settings', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          undefined as any
        )
      ).rejects.toThrow('transcodeSettings is required');
    });

    it('should reject invalid maxWidth (too low)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, maxWidth: 100 }
        )
      ).rejects.toThrow('maxWidth must be a number between 320 and 7680');
    });

    it('should reject invalid maxWidth (too high)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, maxWidth: 10000 }
        )
      ).rejects.toThrow('maxWidth must be a number between 320 and 7680');
    });

    it('should reject invalid maxBitrate (too low)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, maxBitrate: 1000 }
        )
      ).rejects.toThrow('maxBitrate must be a number between 100000 and 100000000');
    });

    it('should reject invalid maxBitrate (too high)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, maxBitrate: 200_000_000 }
        )
      ).rejects.toThrow('maxBitrate must be a number between 100000 and 100000000');
    });

    it('should reject invalid videoCodec', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, videoCodec: 'vp9' }
        )
      ).rejects.toThrow('videoCodec must be h264 or hevc');
    });

    it('should accept valid h264 codec', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test Video',
        'http://test.com/hls',
        3600,
        { ...validSettings, videoCodec: 'h264' }
      );
      expect(session.transcodeSettings.videoCodec).toBe('h264');
    });

    it('should accept valid hevc codec', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test Video',
        'http://test.com/hls',
        3600,
        { ...validSettings, videoCodec: 'hevc' }
      );
      expect(session.transcodeSettings.videoCodec).toBe('hevc');
    });

    it('should reject invalid audioCodec', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, audioCodec: 'mp3' }
        )
      ).rejects.toThrow('audioCodec must be aac');
    });

    it('should reject invalid audioBitrate (too low)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, audioBitrate: 10_000 }
        )
      ).rejects.toThrow('audioBitrate must be a number between 32000 and 640000');
    });

    it('should reject invalid audioBitrate (too high)', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, audioBitrate: 1_000_000 }
        )
      ).rejects.toThrow('audioBitrate must be a number between 32000 and 640000');
    });

    it('should reject invalid audioChannels', async () => {
      await expect(
        service.startDownload(
          'item1',
          'source1',
          'Test Video',
          'http://test.com/hls',
          3600,
          { ...validSettings, audioChannels: 8 }
        )
      ).rejects.toThrow('audioChannels must be 2 or 6');
    });

    it('should accept valid stereo (2 channels)', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test Video',
        'http://test.com/hls',
        3600,
        { ...validSettings, audioChannels: 2 }
      );
      expect(session.transcodeSettings.audioChannels).toBe(2);
    });

    it('should accept valid surround (6 channels)', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test Video',
        'http://test.com/hls',
        3600,
        { ...validSettings, audioChannels: 6 }
      );
      expect(session.transcodeSettings.audioChannels).toBe(6);
    });
  });

  describe('startDownload', () => {
    const validSettings: TranscodeSettings = {
      maxWidth: 1920,
      maxBitrate: 5_000_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 256_000,
      audioChannels: 2,
    };

    it('should create a session with correct initial values', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test Video',
        'http://test.com/hls',
        3600,
        validSettings
      );

      // Session is returned immediately with initial values
      // Status may change to 'transcoding' or 'failed' as processQueue runs async
      expect(session.id).toBeDefined();
      expect(session.itemId).toBe('item1');
      expect(session.mediaSourceId).toBe('source1');
      expect(session.title).toBe('Test Video');
      expect(session.transcodeSettings).toEqual(validSettings);
      expect(session.expectedDurationSeconds).toBe(3600);
    });

    it('should sanitize filename', async () => {
      const session = await service.startDownload(
        'item1',
        'source1',
        'Test: Video (2024) [1080p]',
        'http://test.com/hls',
        3600,
        validSettings
      );

      // Special characters should be removed
      expect(session.filename).toBe('Test Video 2024 1080p.mp4');
    });

    it('should generate unique session IDs', async () => {
      const session1 = await service.startDownload(
        'item1', 'source1', 'Video 1', 'http://test.com/hls', 3600, validSettings
      );
      const session2 = await service.startDownload(
        'item2', 'source2', 'Video 2', 'http://test.com/hls', 3600, validSettings
      );

      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe('getQueueInfo', () => {
    it('should return queue information', () => {
      const info = service.getQueueInfo();

      expect(info).toHaveProperty('activeCount');
      expect(info).toHaveProperty('queuedCount');
      expect(info).toHaveProperty('maxConcurrent');
      expect(info.maxConcurrent).toBe(5);
    });
  });

  describe('getAllDownloads', () => {
    const validSettings: TranscodeSettings = {
      maxWidth: 1920,
      maxBitrate: 5_000_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 256_000,
      audioChannels: 2,
    };

    it('should return empty array when no downloads', () => {
      const downloads = service.getAllDownloads();
      expect(downloads).toEqual([]);
    });

    it('should return all downloads', async () => {
      await service.startDownload(
        'item1', 'source1', 'Video 1', 'http://test.com/hls', 3600, validSettings
      );
      await service.startDownload(
        'item2', 'source2', 'Video 2', 'http://test.com/hls', 3600, validSettings
      );

      const downloads = service.getAllDownloads();
      expect(downloads).toHaveLength(2);
    });
  });

  describe('cancelDownload', () => {
    const validSettings: TranscodeSettings = {
      maxWidth: 1920,
      maxBitrate: 5_000_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 256_000,
      audioChannels: 2,
    };

    it('should cancel a queued download', async () => {
      const session = await service.startDownload(
        'item1', 'source1', 'Video 1', 'http://test.com/hls', 3600, validSettings
      );

      await service.cancelDownload(session.id);

      const downloads = service.getAllDownloads();
      expect(downloads).toHaveLength(0);
    });

    it('should handle canceling non-existent download', async () => {
      // Should not throw
      await expect(service.cancelDownload('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should clean up resources', () => {
      // Should not throw
      expect(() => service.shutdown()).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      service.shutdown();
      service.shutdown();
      // Should not throw
    });
  });
});
