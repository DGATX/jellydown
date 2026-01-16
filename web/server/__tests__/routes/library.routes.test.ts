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

vi.mock('../../services/jellyfin.service', () => ({
  createJellyfinService: vi.fn()
}));

vi.mock('axios');

import libraryRoutes from '../../routes/library.routes';
import { createJellyfinService } from '../../services/jellyfin.service';
import axios from 'axios';

describe('Library Routes', () => {
  let app: Express;
  let mockJellyfinService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockJellyfinService = {
      getLibraryViews: vi.fn(),
      getItems: vi.fn(),
      getSeriesEpisodes: vi.fn(),
      getItem: vi.fn(),
      getImageUrl: vi.fn().mockReturnValue('http://jellyfin.local/image')
    };

    vi.mocked(createJellyfinService).mockReturnValue(mockJellyfinService);

    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
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

    app.use('/api/library', libraryRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/library/views', () => {
    it('should return filtered video library views', async () => {
      const mockViews = [
        { Id: 'movies-id', Name: 'Movies', CollectionType: 'movies' },
        { Id: 'tvshows-id', Name: 'TV Shows', CollectionType: 'tvshows' },
        { Id: 'music-id', Name: 'Music', CollectionType: 'music' },
        { Id: 'homevideos-id', Name: 'Home Videos', CollectionType: 'homevideos' },
        { Id: 'musicvideos-id', Name: 'Music Videos', CollectionType: 'musicvideos' }
      ];
      mockJellyfinService.getLibraryViews.mockResolvedValue(mockViews);

      const res = await request(app)
        .get('/api/library/views');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(4); // Excludes music
      expect(res.body.items.map((i: any) => i.type)).not.toContain('music');
    });

    it('should include image URLs for each view', async () => {
      const mockViews = [
        { Id: 'movies-id', Name: 'Movies', CollectionType: 'movies' }
      ];
      mockJellyfinService.getLibraryViews.mockResolvedValue(mockViews);

      const res = await request(app)
        .get('/api/library/views');

      expect(res.status).toBe(200);
      expect(res.body.items[0].imageUrl).toBe('http://jellyfin.local/image');
      expect(mockJellyfinService.getImageUrl).toHaveBeenCalledWith('movies-id', 'Primary', 300);
    });

    it('should handle empty library views', async () => {
      mockJellyfinService.getLibraryViews.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/library/views');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('should handle unknown collection types', async () => {
      const mockViews = [
        { Id: 'unknown-id', Name: 'Unknown', CollectionType: null }
      ];
      mockJellyfinService.getLibraryViews.mockResolvedValue(mockViews);

      const res = await request(app)
        .get('/api/library/views');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
    });
  });

  describe('GET /api/library/items', () => {
    it('should return items with default parameters', async () => {
      const mockItems = {
        Items: [
          {
            Id: 'movie-1',
            Name: 'Test Movie',
            Type: 'Movie',
            ProductionYear: 2024,
            Overview: 'A test movie',
            CommunityRating: 8.5,
            OfficialRating: 'PG-13',
            RunTimeTicks: 72000000000, // 2 hours in ticks
            BackdropImageTags: ['backdrop1']
          }
        ],
        TotalRecordCount: 1,
        StartIndex: 0
      };
      mockJellyfinService.getItems.mockResolvedValue(mockItems);

      const res = await request(app)
        .get('/api/library/items');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Test Movie');
      expect(res.body.items[0].runtime).toBe(120); // Converted to minutes
      expect(res.body.totalCount).toBe(1);
    });

    it('should pass query parameters correctly', async () => {
      mockJellyfinService.getItems.mockResolvedValue({
        Items: [],
        TotalRecordCount: 0,
        StartIndex: 0
      });

      await request(app)
        .get('/api/library/items')
        .query({
          parentId: 'parent-123',
          includeItemTypes: 'Movie',
          sortBy: 'DateCreated',
          sortOrder: 'Descending',
          limit: '25',
          startIndex: '10',
          searchTerm: 'test',
          recursive: 'true'
        });

      expect(mockJellyfinService.getItems).toHaveBeenCalledWith({
        parentId: 'parent-123',
        includeItemTypes: 'Movie',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 25,
        startIndex: 10,
        searchTerm: 'test',
        recursive: true
      });
    });

    it('should handle TV show episodes', async () => {
      const mockItems = {
        Items: [
          {
            Id: 'ep-1',
            Name: 'Pilot',
            Type: 'Episode',
            SeriesName: 'Test Show',
            ParentIndexNumber: 1,
            IndexNumber: 1,
            RunTimeTicks: null // Unknown runtime
          }
        ],
        TotalRecordCount: 1,
        StartIndex: 0
      };
      mockJellyfinService.getItems.mockResolvedValue(mockItems);

      const res = await request(app)
        .get('/api/library/items');

      expect(res.status).toBe(200);
      expect(res.body.items[0].seriesName).toBe('Test Show');
      expect(res.body.items[0].seasonNumber).toBe(1);
      expect(res.body.items[0].episodeNumber).toBe(1);
      expect(res.body.items[0].runtime).toBeNull();
    });

    it('should handle missing backdrop images', async () => {
      const mockItems = {
        Items: [
          {
            Id: 'movie-1',
            Name: 'No Backdrop Movie',
            Type: 'Movie',
            BackdropImageTags: []
          }
        ],
        TotalRecordCount: 1,
        StartIndex: 0
      };
      mockJellyfinService.getItems.mockResolvedValue(mockItems);

      const res = await request(app)
        .get('/api/library/items');

      expect(res.status).toBe(200);
      expect(res.body.items[0].backdropUrl).toBeNull();
    });
  });

  describe('GET /api/library/series/:id/episodes', () => {
    it('should return episodes for a series', async () => {
      const mockEpisodes = {
        Items: [
          {
            Id: 'ep-1',
            Name: 'Pilot',
            Type: 'Episode',
            ProductionYear: 2024,
            Overview: 'First episode',
            RunTimeTicks: 27000000000,
            SeriesName: 'Test Show',
            ParentIndexNumber: 1,
            IndexNumber: 1
          },
          {
            Id: 'ep-2',
            Name: 'Episode 2',
            Type: 'Episode',
            ProductionYear: 2024,
            RunTimeTicks: 27000000000,
            SeriesName: 'Test Show',
            ParentIndexNumber: 1,
            IndexNumber: 2
          }
        ],
        TotalRecordCount: 2
      };
      mockJellyfinService.getSeriesEpisodes.mockResolvedValue(mockEpisodes);

      const res = await request(app)
        .get('/api/library/series/series-123/episodes');

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].name).toBe('Pilot');
      expect(res.body.items[0].indexNumber).toBe(1);
      expect(res.body.totalCount).toBe(2);
    });

    it('should handle series with no episodes', async () => {
      mockJellyfinService.getSeriesEpisodes.mockResolvedValue({
        Items: [],
        TotalRecordCount: 0
      });

      const res = await request(app)
        .get('/api/library/series/series-123/episodes');

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.totalCount).toBe(0);
    });
  });

  describe('GET /api/library/items/:id', () => {
    it('should return full item details', async () => {
      const mockItem = {
        Id: 'movie-123',
        Name: 'Detailed Movie',
        Type: 'Movie',
        ProductionYear: 2024,
        Overview: 'A detailed movie overview',
        CommunityRating: 8.5,
        OfficialRating: 'PG-13',
        RunTimeTicks: 72000000000,
        BackdropImageTags: ['backdrop1'],
        MediaSources: [{
          Id: 'source-1',
          Container: 'mkv',
          Size: 5000000000,
          Bitrate: 5000000,
          SupportsTranscoding: true,
          MediaStreams: [
            {
              Index: 0,
              Type: 'Video',
              Codec: 'h264',
              Width: 1920,
              Height: 1080,
              BitRate: 4500000
            },
            {
              Index: 1,
              Type: 'Audio',
              Codec: 'aac',
              Language: 'eng',
              DisplayTitle: 'English Stereo',
              Channels: 2,
              IsDefault: true
            },
            {
              Index: 2,
              Type: 'Audio',
              Codec: 'ac3',
              Language: 'jpn',
              DisplayTitle: 'Japanese 5.1',
              Channels: 6,
              IsDefault: false
            },
            {
              Index: 3,
              Type: 'Subtitle',
              Codec: 'srt',
              Language: 'eng',
              DisplayTitle: 'English',
              IsDefault: true,
              IsForced: false
            }
          ]
        }]
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);

      const res = await request(app)
        .get('/api/library/items/movie-123');

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Detailed Movie');
      expect(res.body.runtime).toBe(120);
      expect(res.body.runtimeTicks).toBe(72000000000);
      expect(res.body.videoInfo.codec).toBe('h264');
      expect(res.body.videoInfo.width).toBe(1920);
      expect(res.body.audioStreams).toHaveLength(2);
      expect(res.body.subtitleStreams).toHaveLength(1);
      expect(res.body.mediaSource.container).toBe('mkv');
    });

    it('should handle item with no media sources', async () => {
      const mockItem = {
        Id: 'item-123',
        Name: 'No Sources Item',
        Type: 'Movie',
        MediaSources: []
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);

      const res = await request(app)
        .get('/api/library/items/item-123');

      expect(res.status).toBe(200);
      expect(res.body.mediaSource).toBeNull();
      expect(res.body.videoInfo).toBeNull();
      expect(res.body.audioStreams).toEqual([]);
      expect(res.body.subtitleStreams).toEqual([]);
    });

    it('should handle TV show episode details', async () => {
      const mockItem = {
        Id: 'ep-123',
        Name: 'Pilot',
        Type: 'Episode',
        SeriesName: 'Test Show',
        ParentIndexNumber: 1,
        IndexNumber: 1,
        RunTimeTicks: 27000000000,
        MediaSources: [{
          Id: 'source-1',
          MediaStreams: []
        }]
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);

      const res = await request(app)
        .get('/api/library/items/ep-123');

      expect(res.status).toBe(200);
      expect(res.body.seriesName).toBe('Test Show');
      expect(res.body.seasonNumber).toBe(1);
      expect(res.body.episodeNumber).toBe(1);
    });

    it('should handle audio streams with missing language', async () => {
      const mockItem = {
        Id: 'item-123',
        Name: 'Test',
        Type: 'Movie',
        MediaSources: [{
          Id: 'source-1',
          MediaStreams: [
            {
              Index: 0,
              Type: 'Audio',
              Codec: 'aac',
              Language: null,
              DisplayTitle: null,
              Channels: 2,
              IsDefault: true
            }
          ]
        }]
      };
      mockJellyfinService.getItem.mockResolvedValue(mockItem);

      const res = await request(app)
        .get('/api/library/items/item-123');

      expect(res.status).toBe(200);
      expect(res.body.audioStreams[0].language).toBe('Unknown');
      expect(res.body.audioStreams[0].displayTitle).toBe('Audio 0');
    });
  });

  describe('GET /api/library/items/:id/image', () => {
    it('should proxy image from Jellyfin', async () => {
      const imageBuffer = Buffer.from('fake-image-data');
      vi.mocked(axios.get).mockResolvedValue({
        data: imageBuffer,
        headers: { 'content-type': 'image/jpeg' }
      });

      const res = await request(app)
        .get('/api/library/items/item-123/image');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('should pass image type parameter', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: Buffer.from('fake-image'),
        headers: { 'content-type': 'image/jpeg' }
      });

      await request(app)
        .get('/api/library/items/item-123/image')
        .query({ type: 'Backdrop' });

      expect(mockJellyfinService.getImageUrl).toHaveBeenCalledWith('item-123', 'Backdrop', undefined);
    });

    it('should pass maxWidth parameter', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: Buffer.from('fake-image'),
        headers: { 'content-type': 'image/jpeg' }
      });

      await request(app)
        .get('/api/library/items/item-123/image')
        .query({ maxWidth: '500' });

      expect(mockJellyfinService.getImageUrl).toHaveBeenCalledWith('item-123', 'Primary', 500);
    });

    it('should return 404 when image fails', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('Image not found'));

      const res = await request(app)
        .get('/api/library/items/item-123/image');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Image not found');
    });
  });

  describe('Authentication requirement', () => {
    it('should require authentication for views endpoint', async () => {
      // Create app without auth session
      const unauthApp = express();
      unauthApp.use(express.json());
      unauthApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false
      }));
      unauthApp.use('/api/library', libraryRoutes);

      const res = await request(unauthApp)
        .get('/api/library/views');

      expect(res.status).toBe(401);
    });
  });
});
