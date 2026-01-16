import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../../index', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

const mockSettingsGet = vi.fn();
vi.mock('../../services/settings.service', () => ({
  settingsService: {
    get: (key: string) => mockSettingsGet(key)
  }
}));

// Create mock functions
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockRm = vi.fn();

vi.mock('fs/promises', () => ({
  writeFile: (...args: any[]) => mockWriteFile(...args),
  readFile: (...args: any[]) => mockReadFile(...args),
  readdir: (...args: any[]) => mockReaddir(...args),
  stat: (...args: any[]) => mockStat(...args),
  rm: (...args: any[]) => mockRm(...args)
}));

import { RetentionService, retentionService } from '../../services/retention.service';

describe('RetentionService', () => {
  let service: RetentionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RetentionService();
    mockSettingsGet.mockImplementation((key: string) => {
      if (key === 'downloadsDir') return '/downloads';
      if (key === 'defaultRetentionDays') return null;
      return undefined;
    });
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{}');
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({ isDirectory: () => true, mtime: new Date() });
    mockRm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createRetentionMeta', () => {
    it('should create retention metadata file', async () => {
      const meta = await service.createRetentionMeta('session-123');

      expect(meta.sessionId).toBe('session-123');
      expect(meta.retentionDays).toBeNull();
      expect(meta.expiresAt).toBeNull();
      expect(meta.downloadedAt).toBeDefined();
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/downloads/session-123/retention.json',
        expect.any(String)
      );
    });

    it('should calculate expiresAt when global default is set', async () => {
      mockSettingsGet.mockImplementation((key: string) => {
        if (key === 'downloadsDir') return '/downloads';
        if (key === 'defaultRetentionDays') return 30;
        return undefined;
      });

      const meta = await service.createRetentionMeta('session-456');

      expect(meta.retentionDays).toBeNull();
      expect(meta.expiresAt).not.toBeNull();
    });
  });

  describe('getRetentionMeta', () => {
    it('should return retention metadata when file exists', async () => {
      const mockMeta = {
        sessionId: 'session-123',
        retentionDays: 7,
        downloadedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-08T00:00:00.000Z'
      };
      mockReadFile.mockResolvedValue(JSON.stringify(mockMeta));

      const meta = await service.getRetentionMeta('session-123');

      expect(meta).toEqual(mockMeta);
    });

    it('should return null when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const meta = await service.getRetentionMeta('session-nonexistent');

      expect(meta).toBeNull();
    });
  });

  describe('updateRetention', () => {
    it('should update retention days and recalculate expiresAt', async () => {
      const existingMeta = {
        sessionId: 'session-123',
        retentionDays: null,
        downloadedAt: '2026-01-10T00:00:00.000Z',
        expiresAt: null
      };
      mockReadFile.mockResolvedValue(JSON.stringify(existingMeta));

      const meta = await service.updateRetention('session-123', 14);

      expect(meta.retentionDays).toBe(14);
      expect(meta.expiresAt).not.toBeNull();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should set expiresAt to null when setting retention to forever', async () => {
      const existingMeta = {
        sessionId: 'session-123',
        retentionDays: 7,
        downloadedAt: '2026-01-10T00:00:00.000Z',
        expiresAt: '2026-01-17T00:00:00.000Z'
      };
      mockReadFile.mockResolvedValue(JSON.stringify(existingMeta));

      const meta = await service.updateRetention('session-123', null);

      expect(meta.retentionDays).toBeNull();
      expect(meta.expiresAt).toBeNull();
    });
  });

  describe('getEffectiveRetention', () => {
    it('should return effective days from per-file override', async () => {
      const mockMeta = {
        sessionId: 'session-123',
        retentionDays: 7,
        downloadedAt: '2026-01-10T00:00:00.000Z',
        expiresAt: '2026-01-17T00:00:00.000Z'
      };
      mockReadFile.mockResolvedValue(JSON.stringify(mockMeta));

      const result = await service.getEffectiveRetention('session-123');

      expect(result.retentionDays).toBe(7);
      expect(result.effectiveDays).toBe(7);
      expect(result.isOverride).toBe(true);
    });

    it('should fall back to global default when no override', async () => {
      mockSettingsGet.mockImplementation((key: string) => {
        if (key === 'downloadsDir') return '/downloads';
        if (key === 'defaultRetentionDays') return 30;
        return undefined;
      });

      const mockMeta = {
        sessionId: 'session-123',
        retentionDays: null,
        downloadedAt: '2026-01-10T00:00:00.000Z',
        expiresAt: null
      };
      mockReadFile.mockResolvedValue(JSON.stringify(mockMeta));

      const result = await service.getEffectiveRetention('session-123');

      expect(result.retentionDays).toBeNull();
      expect(result.effectiveDays).toBe(30);
      expect(result.isOverride).toBe(false);
    });
  });

  describe('getExpiredFiles', () => {
    it('should return empty array when global retention is forever and no overrides', async () => {
      mockReaddir.mockResolvedValue(['session-1', 'session-2']);
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const expired = await service.getExpiredFiles();

      expect(expired).toEqual([]);
    });
  });

  describe('singleton', () => {
    it('should export a singleton instance', () => {
      expect(retentionService).toBeInstanceOf(RetentionService);
    });
  });
});
