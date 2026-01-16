import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';

vi.mock('../../config', () => ({
  config: {
    segmentTimeoutMs: 30000,
    appName: 'JellyfinWebDownloader',
    appVersion: '1.0.0',
  },
}));

import { JellyfinService, createJellyfinService } from '../../services/jellyfin.service';
import { TranscodeSettings } from '../../models/types';

describe('JellyfinService', () => {
  const TEST_SERVER_URL = 'http://jellyfin.local';
  const TEST_ACCESS_TOKEN = 'test-access-token';
  const TEST_USER_ID = 'test-user-id';
  const TEST_DEVICE_ID = 'test-device-id';

  let service: JellyfinService;

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('constructor', () => {
    it('should create service with URL only', () => {
      service = new JellyfinService(TEST_SERVER_URL);
      expect(service.getServerUrl()).toBe(TEST_SERVER_URL);
      expect(service.getAccessToken()).toBeUndefined();
      expect(service.getUserId()).toBeUndefined();
      expect(service.getDeviceId()).toBeDefined(); // Auto-generated
    });

    it('should create service with all parameters', () => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
      expect(service.getServerUrl()).toBe(TEST_SERVER_URL);
      expect(service.getAccessToken()).toBe(TEST_ACCESS_TOKEN);
      expect(service.getUserId()).toBe(TEST_USER_ID);
      expect(service.getDeviceId()).toBe(TEST_DEVICE_ID);
    });

    it('should normalize URL by removing trailing slash', () => {
      service = new JellyfinService('http://jellyfin.local/');
      expect(service.getServerUrl()).toBe('http://jellyfin.local');
    });

    it('should preserve https protocol', () => {
      service = new JellyfinService('https://jellyfin.local');
      expect(service.getServerUrl()).toBe('https://jellyfin.local');
    });

    it('should generate device ID if not provided', () => {
      service = new JellyfinService(TEST_SERVER_URL);
      expect(service.getDeviceId()).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('testConnection', () => {
    it('should return server info on successful connection', async () => {
      const serverInfo = {
        ServerName: 'My Jellyfin Server',
        Version: '10.8.0',
        Id: 'server-id-123',
        LocalAddress: 'http://192.168.1.100:8096'
      };

      nock(TEST_SERVER_URL)
        .get('/System/Info/Public')
        .reply(200, serverInfo);

      service = new JellyfinService(TEST_SERVER_URL);
      const result = await service.testConnection();

      expect(result.ServerName).toBe('My Jellyfin Server');
      expect(result.Version).toBe('10.8.0');
      expect(result.Id).toBe('server-id-123');
    });

    it('should throw on connection failure', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info/Public')
        .replyWithError('Connection refused');

      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.testConnection()).rejects.toThrow();
    });

    it('should throw on 404 error', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info/Public')
        .reply(404, { error: 'Not found' });

      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.testConnection()).rejects.toThrow();
    });
  });

  describe('authenticate', () => {
    it('should authenticate successfully and store credentials', async () => {
      const authResult = {
        User: { Id: 'user-123', Name: 'testuser', HasPassword: true },
        AccessToken: 'new-access-token',
        ServerId: 'server-id'
      };

      nock(TEST_SERVER_URL)
        .post('/Users/AuthenticateByName', { Username: 'testuser', Pw: 'password123' })
        .reply(200, authResult);

      service = new JellyfinService(TEST_SERVER_URL);
      const result = await service.authenticate('testuser', 'password123');

      expect(result.AccessToken).toBe('new-access-token');
      expect(result.User.Name).toBe('testuser');
      expect(service.getAccessToken()).toBe('new-access-token');
      expect(service.getUserId()).toBe('user-123');
    });

    it('should throw on invalid credentials', async () => {
      nock(TEST_SERVER_URL)
        .post('/Users/AuthenticateByName')
        .reply(401, { error: 'Invalid credentials' });

      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.authenticate('wrong', 'credentials')).rejects.toThrow();
    });

    it('should send proper MediaBrowser auth header', async () => {
      nock(TEST_SERVER_URL)
        .post('/Users/AuthenticateByName')
        .matchHeader('Authorization', /^MediaBrowser/)
        .matchHeader('X-Emby-Authorization', /^MediaBrowser/)
        .reply(200, {
          User: { Id: 'user-123', Name: 'test', HasPassword: true },
          AccessToken: 'token',
          ServerId: 'server'
        });

      service = new JellyfinService(TEST_SERVER_URL, undefined, undefined, 'fixed-device-id');
      await service.authenticate('test', 'pass');
    });
  });

  describe('getLibraryViews', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should return library views', async () => {
      const views = {
        Items: [
          { Id: 'movies-id', Name: 'Movies', CollectionType: 'movies', Type: 'CollectionFolder' },
          { Id: 'tvshows-id', Name: 'TV Shows', CollectionType: 'tvshows', Type: 'CollectionFolder' }
        ]
      };

      nock(TEST_SERVER_URL)
        .get(`/Users/${TEST_USER_ID}/Views`)
        .reply(200, views);

      const result = await service.getLibraryViews();

      expect(result).toHaveLength(2);
      expect(result[0].Name).toBe('Movies');
      expect(result[1].CollectionType).toBe('tvshows');
    });

    it('should throw if not authenticated', async () => {
      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.getLibraryViews()).rejects.toThrow('Not authenticated');
    });
  });

  describe('getItems', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should return items with default parameters', async () => {
      const itemsResult = {
        Items: [
          { Id: 'movie-1', Name: 'Test Movie', Type: 'Movie' }
        ],
        TotalRecordCount: 1,
        StartIndex: 0
      };

      nock(TEST_SERVER_URL)
        .get(`/Users/${TEST_USER_ID}/Items`)
        .query(true)
        .reply(200, itemsResult);

      const result = await service.getItems();

      expect(result.Items).toHaveLength(1);
      expect(result.Items[0].Name).toBe('Test Movie');
    });

    it('should pass query parameters correctly', async () => {
      nock(TEST_SERVER_URL)
        .get(`/Users/${TEST_USER_ID}/Items`)
        .query((actualQuery) => {
          // Verify all expected query params are present
          return (
            actualQuery.ParentId === 'parent-123' &&
            actualQuery.IncludeItemTypes === 'Movie' &&
            actualQuery.SortBy === 'Name' &&
            actualQuery.SortOrder === 'Ascending' &&
            actualQuery.Limit === '50' &&
            actualQuery.StartIndex === '10' &&
            actualQuery.SearchTerm === 'test' &&
            actualQuery.Recursive === 'true' &&
            typeof actualQuery.Fields === 'string'
          );
        })
        .reply(200, { Items: [], TotalRecordCount: 0, StartIndex: 10 });

      await service.getItems({
        parentId: 'parent-123',
        includeItemTypes: 'Movie',
        sortBy: 'Name',
        sortOrder: 'Ascending',
        limit: 50,
        startIndex: 10,
        searchTerm: 'test',
        recursive: true
      });
    });

    it('should throw if not authenticated', async () => {
      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.getItems()).rejects.toThrow('Not authenticated');
    });
  });

  describe('getSeriesEpisodes', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should return episodes for a series', async () => {
      const episodesResult = {
        Items: [
          { Id: 'ep-1', Name: 'Pilot', Type: 'Episode', IndexNumber: 1 },
          { Id: 'ep-2', Name: 'Episode 2', Type: 'Episode', IndexNumber: 2 }
        ],
        TotalRecordCount: 2,
        StartIndex: 0
      };

      nock(TEST_SERVER_URL)
        .get('/Shows/series-123/Episodes')
        .query(true)
        .reply(200, episodesResult);

      const result = await service.getSeriesEpisodes('series-123');

      expect(result.Items).toHaveLength(2);
      expect(result.Items[0].Name).toBe('Pilot');
    });

    it('should throw if not authenticated', async () => {
      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.getSeriesEpisodes('series-id')).rejects.toThrow('Not authenticated');
    });
  });

  describe('getItem', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should return single item details', async () => {
      const item = {
        Id: 'item-123',
        Name: 'Test Movie',
        Type: 'Movie',
        Overview: 'A test movie',
        RunTimeTicks: 72000000000
      };

      nock(TEST_SERVER_URL)
        .get(`/Users/${TEST_USER_ID}/Items/item-123`)
        .query(true)
        .reply(200, item);

      const result = await service.getItem('item-123');

      expect(result.Id).toBe('item-123');
      expect(result.Name).toBe('Test Movie');
      expect(result.Overview).toBe('A test movie');
    });

    it('should throw if not authenticated', async () => {
      service = new JellyfinService(TEST_SERVER_URL);

      await expect(service.getItem('item-id')).rejects.toThrow('Not authenticated');
    });

    it('should throw on 404', async () => {
      nock(TEST_SERVER_URL)
        .get(`/Users/${TEST_USER_ID}/Items/non-existent`)
        .query(true)
        .reply(404, { error: 'Item not found' });

      await expect(service.getItem('non-existent')).rejects.toThrow();
    });
  });

  describe('buildHLSUrl', () => {
    const settings: TranscodeSettings = {
      maxWidth: 1920,
      maxBitrate: 5_000_000,
      videoCodec: 'h264',
      audioCodec: 'aac',
      audioBitrate: 192_000,
      audioChannels: 2
    };

    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should build valid HLS URL', () => {
      const url = service.buildHLSUrl('item-123', 'source-456', settings);

      expect(url).toContain(`${TEST_SERVER_URL}/Videos/item-123/master.m3u8`);
      expect(url).toContain('MediaSourceId=source-456');
      expect(url).toContain('VideoCodec=h264');
      expect(url).toContain('AudioCodec=aac');
      expect(url).toContain('VideoBitrate=5000000');
      expect(url).toContain('AudioBitrate=192000');
      expect(url).toContain('MaxWidth=1920');
      expect(url).toContain('TranscodingMaxAudioChannels=2');
      expect(url).toContain('SegmentContainer=mp4');
      expect(url).toContain('BreakOnNonKeyFrames=true');
      expect(url).toContain(`api_key=${TEST_ACCESS_TOKEN}`);
    });

    it('should include audio stream index', () => {
      const url = service.buildHLSUrl('item-123', 'source-456', settings, 2);

      expect(url).toContain('AudioStreamIndex=2');
    });

    it('should include subtitle stream index and encode method', () => {
      const url = service.buildHLSUrl('item-123', 'source-456', settings, 0, 3);

      expect(url).toContain('SubtitleStreamIndex=3');
      expect(url).toContain('SubtitleMethod=Encode');
    });

    it('should work without access token', () => {
      service = new JellyfinService(TEST_SERVER_URL);
      const url = service.buildHLSUrl('item-123', 'source-456', settings);

      expect(url).toContain('api_key=');
    });
  });

  describe('getImageUrl', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should build image URL with default type', () => {
      const url = service.getImageUrl('item-123');

      expect(url).toBe(`${TEST_SERVER_URL}/Items/item-123/Images/Primary`);
    });

    it('should build image URL with specified type', () => {
      const url = service.getImageUrl('item-123', 'Backdrop');

      expect(url).toBe(`${TEST_SERVER_URL}/Items/item-123/Images/Backdrop`);
    });

    it('should include maxWidth parameter', () => {
      const url = service.getImageUrl('item-123', 'Primary', 300);

      expect(url).toBe(`${TEST_SERVER_URL}/Items/item-123/Images/Primary?maxWidth=300`);
    });
  });

  describe('getSystemInfo', () => {
    beforeEach(() => {
      service = new JellyfinService(TEST_SERVER_URL, TEST_ACCESS_TOKEN, TEST_USER_ID, TEST_DEVICE_ID);
    });

    it('should return system info with hardware acceleration', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .reply(200, {
          ServerName: 'Test Server',
          Version: '10.8.0'
        });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration/encoding')
        .reply(200, {
          HardwareAccelerationType: 'vaapi'
        });

      const result = await service.getSystemInfo();

      expect(result.serverName).toBe('Test Server');
      expect(result.version).toBe('10.8.0');
      expect(result.hardwareAccelerationEnabled).toBe(true);
      expect(result.encoderLocationType).toBe('vaapi');
    });

    it('should fall back to full configuration endpoint', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .reply(200, {
          ServerName: 'Test Server',
          Version: '10.8.0'
        });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration/encoding')
        .reply(403, { error: 'Forbidden' });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration')
        .reply(200, {
          EncodingOptions: {
            HardwareAccelerationType: 'nvenc'
          }
        });

      const result = await service.getSystemInfo();

      expect(result.hardwareAccelerationEnabled).toBe(true);
      expect(result.encoderLocationType).toBe('nvenc');
    });

    it('should handle no hardware acceleration', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .reply(200, {
          ServerName: 'Test Server',
          Version: '10.8.0'
        });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration/encoding')
        .reply(200, {
          HardwareAccelerationType: 'none'
        });

      const result = await service.getSystemInfo();

      expect(result.hardwareAccelerationEnabled).toBe(false);
    });

    it('should handle empty hardware acceleration type', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .reply(200, {
          ServerName: 'Test Server',
          Version: '10.8.0'
        });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration/encoding')
        .reply(200, {
          HardwareAccelerationType: ''
        });

      const result = await service.getSystemInfo();

      expect(result.hardwareAccelerationEnabled).toBe(false);
    });

    it('should handle error gracefully', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .replyWithError('Connection refused');

      const result = await service.getSystemInfo();

      expect(result.serverName).toBe('Jellyfin Server');
      expect(result.version).toBe('Unknown');
      expect(result.hardwareAccelerationEnabled).toBe(false);
      expect(result.encoderLocationType).toBe('error');
    });

    it('should handle non-admin user gracefully', async () => {
      nock(TEST_SERVER_URL)
        .get('/System/Info')
        .reply(200, {
          ServerName: 'Test Server',
          Version: '10.8.0'
        });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration/encoding')
        .reply(403, { error: 'Forbidden' });

      nock(TEST_SERVER_URL)
        .get('/System/Configuration')
        .reply(403, { error: 'Forbidden' });

      const result = await service.getSystemInfo();

      expect(result.serverName).toBe('Test Server');
      expect(result.hardwareAccelerationEnabled).toBe(false);
      expect(result.encoderLocationType).toBe('unknown (requires admin)');
    });
  });

  describe('createJellyfinService factory', () => {
    it('should create service from session object', () => {
      const session = {
        serverUrl: TEST_SERVER_URL,
        accessToken: TEST_ACCESS_TOKEN,
        userId: TEST_USER_ID,
        deviceId: TEST_DEVICE_ID
      };

      const service = createJellyfinService(session);

      expect(service.getServerUrl()).toBe(TEST_SERVER_URL);
      expect(service.getAccessToken()).toBe(TEST_ACCESS_TOKEN);
      expect(service.getUserId()).toBe(TEST_USER_ID);
      expect(service.getDeviceId()).toBe(TEST_DEVICE_ID);
    });
  });
});
