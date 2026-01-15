import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.middleware';
import { createJellyfinService } from '../services/jellyfin.service';

const router = Router();

// All library routes require authentication
router.use(requireAuth);

// Get library views (Movies, TV Shows, etc.)
router.get('/views', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jellyfin = createJellyfinService(req.session.jellyfin!);
    const views = await jellyfin.getLibraryViews();

    // Filter to video libraries only
    const videoViews = views.filter(v =>
      v.CollectionType === 'movies' ||
      v.CollectionType === 'tvshows' ||
      v.CollectionType === 'homevideos' ||
      v.CollectionType === 'musicvideos'
    );

    res.json({
      items: videoViews.map(v => ({
        id: v.Id,
        name: v.Name,
        type: v.CollectionType || 'unknown',
        imageUrl: jellyfin.getImageUrl(v.Id, 'Primary', 300)
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Get items in a library
router.get('/items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jellyfin = createJellyfinService(req.session.jellyfin!);

    const result = await jellyfin.getItems({
      parentId: req.query.parentId as string,
      includeItemTypes: req.query.includeItemTypes as string || 'Movie',
      sortBy: req.query.sortBy as string || 'SortName',
      sortOrder: req.query.sortOrder as string || 'Ascending',
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      startIndex: req.query.startIndex ? parseInt(req.query.startIndex as string, 10) : 0,
      searchTerm: req.query.searchTerm as string,
      recursive: req.query.recursive === 'true'
    });

    res.json({
      items: result.Items.map(item => ({
        id: item.Id,
        name: item.Name,
        type: item.Type,
        year: item.ProductionYear,
        overview: item.Overview,
        rating: item.CommunityRating,
        officialRating: item.OfficialRating,
        runtime: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : null, // Convert to minutes
        imageUrl: jellyfin.getImageUrl(item.Id, 'Primary', 300),
        backdropUrl: item.BackdropImageTags?.length
          ? jellyfin.getImageUrl(item.Id, 'Backdrop', 1280)
          : null,
        seriesName: item.SeriesName,
        seasonNumber: item.ParentIndexNumber,
        episodeNumber: item.IndexNumber
      })),
      totalCount: result.TotalRecordCount,
      startIndex: result.StartIndex
    });
  } catch (err) {
    next(err);
  }
});

// Get single item details
router.get('/items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jellyfin = createJellyfinService(req.session.jellyfin!);
    const item = await jellyfin.getItem(req.params.id);

    // Get media sources and streams
    const mediaSources = item.MediaSources || [];
    const defaultSource = mediaSources[0];

    // Extract audio and subtitle streams
    const audioStreams = defaultSource?.MediaStreams?.filter(s => s.Type === 'Audio') || [];
    const subtitleStreams = defaultSource?.MediaStreams?.filter(s => s.Type === 'Subtitle') || [];
    const videoStream = defaultSource?.MediaStreams?.find(s => s.Type === 'Video');

    res.json({
      id: item.Id,
      name: item.Name,
      type: item.Type,
      year: item.ProductionYear,
      overview: item.Overview,
      rating: item.CommunityRating,
      officialRating: item.OfficialRating,
      runtime: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 600000000) : null,
      runtimeTicks: item.RunTimeTicks,
      imageUrl: jellyfin.getImageUrl(item.Id, 'Primary', 400),
      backdropUrl: item.BackdropImageTags?.length
        ? jellyfin.getImageUrl(item.Id, 'Backdrop', 1920)
        : null,
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      mediaSource: defaultSource ? {
        id: defaultSource.Id,
        container: defaultSource.Container,
        size: defaultSource.Size,
        bitrate: defaultSource.Bitrate,
        supportsTranscoding: defaultSource.SupportsTranscoding
      } : null,
      videoInfo: videoStream ? {
        codec: videoStream.Codec,
        width: videoStream.Width,
        height: videoStream.Height,
        bitrate: videoStream.BitRate
      } : null,
      audioStreams: audioStreams.map(s => ({
        index: s.Index,
        codec: s.Codec,
        language: s.Language || 'Unknown',
        displayTitle: s.DisplayTitle || `Audio ${s.Index}`,
        channels: s.Channels,
        isDefault: s.IsDefault
      })),
      subtitleStreams: subtitleStreams.map(s => ({
        index: s.Index,
        codec: s.Codec,
        language: s.Language || 'Unknown',
        displayTitle: s.DisplayTitle || `Subtitle ${s.Index}`,
        isDefault: s.IsDefault,
        isForced: s.IsForced
      }))
    });
  } catch (err) {
    next(err);
  }
});

// Proxy image from Jellyfin (avoids CORS issues)
router.get('/items/:id/image', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jellyfin = createJellyfinService(req.session.jellyfin!);
    const imageType = (req.query.type as string) || 'Primary';
    const maxWidth = req.query.maxWidth ? parseInt(req.query.maxWidth as string, 10) : undefined;

    const imageUrl = jellyfin.getImageUrl(req.params.id, imageType, maxWidth);

    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });

    res.set('Content-Type', response.headers['content-type']);
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
    res.send(response.data);
  } catch (err) {
    // Return a placeholder if image fails
    res.status(404).json({ error: 'Image not found' });
  }
});

export default router;
