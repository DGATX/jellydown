import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';

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
    segmentTimeoutMs: 30000,
  },
}));

import { HLSParserService, hlsParser } from '../../services/hls-parser.service';

describe('HLSParserService', () => {
  let service: HLSParserService;

  beforeEach(() => {
    service = new HLSParserService();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('parseMasterPlaylist', () => {
    it('should parse a valid master playlist', async () => {
      const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
media_0.m3u8`;

      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .query(true)
        .reply(200, masterPlaylist);

      const result = await service.parseMasterPlaylist(
        'http://jellyfin.local/video/master.m3u8?api_key=test123'
      );

      expect(result.mediaPlaylistUrl).toBe('http://jellyfin.local/video/media_0.m3u8?api_key=test123');
      expect(result.bandwidth).toBe(2500000);
      expect(result.resolution).toBe('1280x720');
      expect(result.codecs).toBe('avc1.640028,mp4a.40.2');
    });

    it('should parse master playlist with multiple streams (takes first)', async () => {
      const masterPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
medium.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
low.m3u8`;

      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .reply(200, masterPlaylist);

      const result = await service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8');

      expect(result.mediaPlaylistUrl).toBe('http://jellyfin.local/video/high.m3u8');
      expect(result.bandwidth).toBe(5000000);
      expect(result.resolution).toBe('1920x1080');
    });

    it('should throw error for empty master playlist', async () => {
      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .reply(200, '#EXTM3U\n#EXT-X-VERSION:3');

      await expect(
        service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8')
      ).rejects.toThrow('No media playlist found in master playlist');
    });

    it('should throw error for invalid playlist (no STREAM-INF)', async () => {
      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .reply(200, '#EXTM3U\nsome random content');

      await expect(
        service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8')
      ).rejects.toThrow('No media playlist found in master playlist');
    });

    it('should handle network errors', async () => {
      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .replyWithError('Connection refused');

      await expect(
        service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8')
      ).rejects.toThrow();
    });

    it('should handle HTTP errors', async () => {
      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .reply(404, { error: 'Not found' });

      await expect(
        service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8')
      ).rejects.toThrow();
    });

    it('should handle absolute URL in master playlist', async () => {
      const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2500000
https://cdn.example.com/media.m3u8`;

      nock('http://jellyfin.local')
        .get('/video/master.m3u8')
        .reply(200, masterPlaylist);

      const result = await service.parseMasterPlaylist('http://jellyfin.local/video/master.m3u8');

      expect(result.mediaPlaylistUrl).toBe('https://cdn.example.com/media.m3u8');
    });
  });

  describe('parseMediaPlaylist', () => {
    it('should parse a valid media playlist with fMP4 segments', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
segment0.m4s
#EXTINF:6.0,
segment1.m4s
#EXTINF:4.5,
segment2.m4s
#EXT-X-ENDLIST`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist('http://jellyfin.local/video/media.m3u8');

      expect(result.segments).toHaveLength(3);
      expect(result.initSegmentUrl).toBe('http://jellyfin.local/video/init.mp4');
      expect(result.targetDuration).toBe(6);
      expect(result.totalDuration).toBeCloseTo(16.5);
      expect(result.isComplete).toBe(true);

      expect(result.segments[0]).toEqual({
        index: 0,
        url: 'http://jellyfin.local/video/segment0.m4s',
        duration: 6.0,
        byteRange: undefined,
      });
    });

    it('should parse media playlist with byte ranges', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
#EXT-X-BYTERANGE:500000@0
segments.m4s
#EXTINF:6.0,
#EXT-X-BYTERANGE:600000@500000
segments.m4s
#EXT-X-ENDLIST`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist('http://jellyfin.local/video/media.m3u8');

      expect(result.segments[0].byteRange).toEqual({ length: 500000, offset: 0 });
      expect(result.segments[1].byteRange).toEqual({ length: 600000, offset: 500000 });
    });

    it('should parse byte range without offset', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
#EXT-X-BYTERANGE:500000
segment.m4s
#EXT-X-ENDLIST`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist('http://jellyfin.local/video/media.m3u8');

      expect(result.segments[0].byteRange).toEqual({ length: 500000, offset: 0 });
    });

    it('should detect incomplete playlist (live stream)', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment0.m4s`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist('http://jellyfin.local/video/media.m3u8');

      expect(result.isComplete).toBe(false);
    });

    it('should handle empty media playlist', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-ENDLIST`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist('http://jellyfin.local/video/media.m3u8');

      expect(result.segments).toHaveLength(0);
      expect(result.totalDuration).toBe(0);
    });

    it('should preserve query params when resolving segment URLs', async () => {
      const mediaPlaylist = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment0.m4s?token=abc
#EXT-X-ENDLIST`;

      nock('http://jellyfin.local')
        .get('/video/media.m3u8')
        .query({ api_key: 'test' })
        .reply(200, mediaPlaylist);

      const result = await service.parseMediaPlaylist(
        'http://jellyfin.local/video/media.m3u8?api_key=test'
      );

      expect(result.segments[0].url).toContain('segment0.m4s');
      expect(result.segments[0].url).toContain('token=abc');
    });
  });

  describe('parseMediaPlaylistContent', () => {
    it('should parse content directly without HTTP request', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].url).toBe('http://jellyfin.local/video/segment0.m4s');
    });

    it('should handle quoted URI in EXT-X-MAP', () => {
      const content = `#EXTM3U
#EXT-X-MAP:URI="init-segment.mp4"
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.initSegmentUrl).toBe('http://jellyfin.local/video/init-segment.mp4');
    });

    it('should handle different line endings (CRLF)', () => {
      const content = '#EXTM3U\r\n#EXT-X-TARGETDURATION:6\r\n#EXTINF:6.0,\r\nsegment0.m4s\r\n#EXT-X-ENDLIST';

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.segments).toHaveLength(1);
    });

    it('should handle segment URLs with special characters', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment with spaces.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      // URL encoding converts spaces to %20, which is correct behavior
      expect(result.segments[0].url).toContain('segment%20with%20spaces.m4s');
    });

    it('should calculate total duration correctly', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:5.5,
segment0.m4s
#EXTINF:6.0,
segment1.m4s
#EXTINF:4.123,
segment2.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.totalDuration).toBeCloseTo(15.623);
    });
  });

  describe('attribute parsing', () => {
    it('should parse attributes with quoted values correctly', async () => {
      const masterPlaylist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1280x720
media.m3u8`;

      nock('http://jellyfin.local')
        .get('/master.m3u8')
        .reply(200, masterPlaylist);

      const result = await service.parseMasterPlaylist('http://jellyfin.local/master.m3u8');

      expect(result.codecs).toBe('avc1.640028,mp4a.40.2');
    });
  });

  describe('URL resolution', () => {
    it('should handle relative URLs correctly', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
../segments/segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/hls/media.m3u8'
      );

      // The URL class will resolve the path
      expect(result.segments[0].url).toBe('http://jellyfin.local/video/segments/segment0.m4s');
    });

    it('should preserve existing query parameters from base URL', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8?api_key=secret&user_id=123'
      );

      expect(result.segments[0].url).toContain('api_key=secret');
      expect(result.segments[0].url).toContain('user_id=123');
    });
  });

  describe('singleton export', () => {
    it('should export a singleton instance', () => {
      expect(hlsParser).toBeInstanceOf(HLSParserService);
    });
  });

  describe('edge cases', () => {
    it('should handle playlist with comments', () => {
      const content = `#EXTM3U
# This is a comment
#EXT-X-TARGETDURATION:6
# Another comment
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.segments).toHaveLength(1);
    });

    it('should handle duration with extra text after comma', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.123456,Title of segment
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.segments[0].duration).toBeCloseTo(6.123456);
    });

    it('should default to 6 second target duration if missing', () => {
      const content = `#EXTM3U
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.targetDuration).toBe(6);
    });

    it('should handle invalid target duration gracefully', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:invalid
#EXTINF:6.0,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      // NaN || 6 = 6
      expect(result.targetDuration).toBe(6);
    });

    it('should handle segments with no duration (default to 0)', () => {
      const content = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:,
segment0.m4s
#EXT-X-ENDLIST`;

      const result = service.parseMediaPlaylistContent(
        content,
        'http://jellyfin.local/video/media.m3u8'
      );

      expect(result.segments[0].duration).toBe(0);
    });
  });
});
