import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
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
    maxConcurrentSegments: 3,
    segmentTimeoutMs: 30000
  }
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn()
  }
}));

vi.mock('fs', () => ({
  default: {
    createReadStream: vi.fn(),
    createWriteStream: vi.fn()
  }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

import { SegmentService, segmentService } from '../../services/segment.service';
import fsp from 'fs/promises';

describe('SegmentService', () => {
  let service: SegmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SegmentService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('calculateTotalSize', () => {
    it('should sum sizes of all segments with init segment', async () => {
      vi.mocked(fsp.stat)
        .mockResolvedValueOnce({ size: 500 } as any)  // init segment
        .mockResolvedValueOnce({ size: 1000 } as any) // segment 1
        .mockResolvedValueOnce({ size: 2000 } as any) // segment 2
        .mockResolvedValueOnce({ size: 3000 } as any); // segment 3

      const sizes = await service.calculateTotalSize(
        '/tmp/init.mp4',
        ['/tmp/seg1.mp4', '/tmp/seg2.mp4', '/tmp/seg3.mp4']
      );

      expect(sizes).toBe(6500);
    });

    it('should work without init segment', async () => {
      vi.mocked(fsp.stat).mockResolvedValue({ size: 1500 } as any);

      const sizes = await service.calculateTotalSize(
        undefined,
        ['/tmp/seg1.mp4']
      );

      expect(sizes).toBe(1500);
    });

    it('should return 0 for empty segments', async () => {
      const sizes = await service.calculateTotalSize(undefined, []);

      expect(sizes).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove temp directory', async () => {
      vi.mocked(fsp.rm).mockResolvedValue(undefined);

      await service.cleanup('/tmp/session-123');

      expect(fsp.rm).toHaveBeenCalledWith('/tmp/session-123', {
        recursive: true,
        force: true
      });
    });

    it('should ignore cleanup errors', async () => {
      vi.mocked(fsp.rm).mockRejectedValue(new Error('ENOENT'));

      // Should not throw
      await service.cleanup('/tmp/session-123');

      expect(fsp.rm).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should export a singleton instance', () => {
      expect(segmentService).toBeInstanceOf(SegmentService);
    });
  });
});
