import { Router, Request, Response, NextFunction } from 'express';
import fsp from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { requireAuth } from '../middleware/auth.middleware';
import { createJellyfinService } from '../services/jellyfin.service';
import { downloadService } from '../services/download.service';
import { settingsService } from '../services/settings.service';
import { retentionService } from '../services/retention.service';
import { BatchDownloadRequest, BatchDownloadResult, BatchCancelRequest, BatchCancelResult, DownloadSession } from '../models/types';
import { config } from '../config';
import { logger } from '../index';

const execAsync = promisify(exec);

const router = Router();

// All download routes require authentication
router.use(requireAuth);

// Get all active downloads
router.get('/list', (_req: Request, res: Response) => {
  const downloads = downloadService.getAllDownloads();
  res.json({ downloads });
});

// Get available transcode presets
router.get('/presets', (_req: Request, res: Response) => {
  const customPresets = settingsService.get('presets');
  const presets = customPresets.map(preset => {
    const resolution = preset.maxWidth <= 854 ? '480p' :
                       preset.maxWidth <= 1280 ? '720p' :
                       preset.maxWidth <= 1920 ? '1080p' : '4K';
    const estimatedSizePerHour = Math.round(((preset.maxBitrate + preset.audioBitrate) * 3600) / 8 / 1_000_000);
    const sizePerHourFormatted = estimatedSizePerHour >= 1000
      ? `~${(estimatedSizePerHour / 1000).toFixed(1)} GB/hr`
      : `~${estimatedSizePerHour} MB/hr`;

    // Generate human-readable description
    let description = '';
    if (preset.maxWidth <= 854) {
      description = 'Best for mobile data saving';
    } else if (preset.maxWidth <= 1280) {
      description = 'Good balance of quality & size';
    } else if (preset.maxWidth <= 1920) {
      description = 'High quality for larger screens';
    } else {
      description = 'Maximum quality, large files';
    }

    return {
      id: preset.id,
      name: preset.name,
      resolution,
      maxWidth: preset.maxWidth,
      bitrate: preset.maxBitrate,
      bitrateFormatted: `${(preset.maxBitrate / 1_000_000).toFixed(1)} Mbps`,
      estimatedSizePerHour,
      sizePerHourFormatted,
      description,
      videoCodec: preset.videoCodec || 'h264'
    };
  });

  res.json({ presets });
});

// Helper to get preset settings by id
function getPresetById(presetId: string) {
  const presets = settingsService.get('presets');
  return presets.find(p => p.id === presetId);
}

// Start a download
router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { itemId, mediaSourceId, preset, audioStreamIndex, subtitleStreamIndex, subtitleMethod } = req.body;

    logger.info(`Download request received: itemId=${itemId}, preset=${preset}, subtitles=${subtitleStreamIndex ?? 'none'}, method=${subtitleMethod || 'burn'}`);

    if (!itemId || !preset) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'itemId and preset are required'
      });
    }

    const transcodeSettings = getPresetById(preset);
    if (!transcodeSettings) {
      const validPresets = settingsService.get('presets').map(p => p.id);
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid preset: ${preset}. Valid options: ${validPresets.join(', ')}`
      });
    }

    // Get item details
    const jellyfin = createJellyfinService(req.session.jellyfin!);
    const item = await jellyfin.getItem(itemId);

    if (!item.MediaSources || item.MediaSources.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No media sources available for this item'
      });
    }

    const sourceId = mediaSourceId || item.MediaSources[0].Id;
    const audioIndex = audioStreamIndex ?? 0;
    const subtitleIndex = subtitleStreamIndex !== undefined && subtitleStreamIndex >= 0
      ? subtitleStreamIndex
      : undefined;
    const useSoftSubtitles = subtitleMethod === 'soft' && subtitleIndex !== undefined;

    // Calculate expected duration in seconds
    const durationSeconds = item.RunTimeTicks
      ? item.RunTimeTicks / 10_000_000
      : 7200; // Default 2 hours if unknown

    // Build HLS URL (only burn subtitles if not using soft subs)
    // For soft subs, we'll mux them after downloading the video
    const hlsSubtitleIndex = useSoftSubtitles ? undefined : subtitleIndex;
    const hlsUrl = jellyfin.buildHLSUrl(itemId, sourceId, transcodeSettings, audioIndex, hlsSubtitleIndex);

    // Build title
    let title = item.Name;
    if (item.SeriesName) {
      const season = item.ParentIndexNumber ? `S${String(item.ParentIndexNumber).padStart(2, '0')}` : '';
      const episode = item.IndexNumber ? `E${String(item.IndexNumber).padStart(2, '0')}` : '';
      title = `${item.SeriesName} - ${season}${episode} - ${item.Name}`;
    }

    // Estimate file size
    const estimatedSize = Math.round(
      ((transcodeSettings.maxBitrate + transcodeSettings.audioBitrate) * durationSeconds) / 8
    );

    // Build soft subtitle info if needed
    let softSubtitle: DownloadSession['softSubtitle'];
    if (useSoftSubtitles && subtitleIndex !== undefined) {
      const mediaSource = item.MediaSources.find((s: any) => s.Id === sourceId) || item.MediaSources[0];
      const subtitleStream = mediaSource?.MediaStreams?.find((s: any) => s.Index === subtitleIndex && s.Type === 'Subtitle');

      softSubtitle = {
        streamIndex: subtitleIndex,
        language: subtitleStream?.Language,
        codec: subtitleStream?.Codec,
        jellyfinUrl: req.session.jellyfin!.serverUrl,
        accessToken: req.session.jellyfin!.accessToken
      };
      logger.info(`Soft subtitles enabled: stream ${softSubtitle.streamIndex}, language=${softSubtitle.language}, codec=${softSubtitle.codec}`);
    }

    // Start download
    const session = await downloadService.startDownload(
      itemId,
      sourceId,
      title,
      hlsUrl,
      durationSeconds,
      transcodeSettings,
      softSubtitle
    );

    res.json({
      sessionId: session.id,
      filename: session.filename,
      estimatedSize,
      estimatedSizeFormatted: formatBytes(estimatedSize)
    });
  } catch (err) {
    next(err);
  }
});

// Start batch download (multiple items at once)
router.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { items, preset, audioStreamIndex, subtitleStreamIndex }: BatchDownloadRequest = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'items array is required'
      });
    }

    if (!preset) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'preset is required'
      });
    }

    const transcodeSettings = getPresetById(preset);
    if (!transcodeSettings) {
      const validPresets = settingsService.get('presets').map(p => p.id);
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid preset: ${preset}. Valid options: ${validPresets.join(', ')}`
      });
    }

    const jellyfin = createJellyfinService(req.session.jellyfin!);
    const results: BatchDownloadResult[] = [];
    const subtitleIndex = subtitleStreamIndex !== undefined && subtitleStreamIndex >= 0
      ? subtitleStreamIndex
      : undefined;

    for (const item of items) {
      try {
        const mediaItem = await jellyfin.getItem(item.itemId);

        if (!mediaItem.MediaSources || mediaItem.MediaSources.length === 0) {
          results.push({
            itemId: item.itemId,
            success: false,
            error: 'No media sources available'
          });
          continue;
        }

        const sourceId = item.mediaSourceId || mediaItem.MediaSources[0].Id;
        const audioIndex = audioStreamIndex ?? 0;

        const durationSeconds = mediaItem.RunTimeTicks
          ? mediaItem.RunTimeTicks / 10_000_000
          : 7200;

        const hlsUrl = jellyfin.buildHLSUrl(item.itemId, sourceId, transcodeSettings, audioIndex, subtitleIndex);

        // Build title
        let title = mediaItem.Name;
        if (mediaItem.SeriesName) {
          const season = mediaItem.ParentIndexNumber ? `S${String(mediaItem.ParentIndexNumber).padStart(2, '0')}` : '';
          const episode = mediaItem.IndexNumber ? `E${String(mediaItem.IndexNumber).padStart(2, '0')}` : '';
          title = `${mediaItem.SeriesName} - ${season}${episode} - ${mediaItem.Name}`;
        }

        const session = await downloadService.startDownload(
          item.itemId,
          sourceId,
          title,
          hlsUrl,
          durationSeconds,
          transcodeSettings
        );

        results.push({
          itemId: item.itemId,
          sessionId: session.id,
          filename: session.filename,
          success: true
        });
      } catch (err) {
        results.push({
          itemId: item.itemId,
          success: false,
          error: (err as Error).message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`Batch download: ${successCount}/${items.length} items queued`);

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// Cancel/remove batch downloads by item IDs
router.delete('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { itemIds }: BatchCancelRequest = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'itemIds array is required'
      });
    }

    const result: BatchCancelResult = await downloadService.cancelByItemIds(itemIds);
    logger.info(`Batch cancel: ${result.cancelled} cancelled, ${result.removed} removed`);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get download progress
router.get('/progress/:sessionId', (req: Request, res: Response) => {
  const progress = downloadService.getProgress(req.params.sessionId);

  if (!progress) {
    return res.status(404).json({
      error: 'Not Found',
      message: 'Download session not found'
    });
  }

  res.json(progress);
});

// Stream completed download (supports range requests for resume)
router.get('/stream/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rangeHeader = req.headers.range;
    await downloadService.streamToResponse(req.params.sessionId, res, rangeHeader);
  } catch (err) {
    next(err);
  }
});

// Cancel download
router.delete('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await downloadService.cancelDownload(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Remove failed/completed download from list
router.delete('/:sessionId/remove', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const removed = await downloadService.removeDownload(req.params.sessionId);
    if (!removed) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot remove active downloads. Cancel first.'
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Resume a failed download
router.post('/:sessionId/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await downloadService.resumeDownload(req.params.sessionId);
    res.json({
      sessionId: session.id,
      status: session.status,
      message: `Resumed download: ${session.completedSegments}/${session.totalSegments} segments already completed`
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Queue Management
// ============================================

// Pause a queued download
router.post('/:sessionId/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await downloadService.pauseDownload(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Resume a paused download (different from resuming failed)
router.post('/:sessionId/unpause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await downloadService.resumePausedDownload(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Move download to front of queue
router.post('/:sessionId/move-to-front', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await downloadService.moveToFront(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Reorder download in queue
router.put('/:sessionId/position', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { position } = req.body;
    if (typeof position !== 'number' || position < 1) {
      return res.status(400).json({ error: 'Invalid position' });
    }
    await downloadService.reorderQueue(req.params.sessionId, position);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Get queue info
router.get('/queue/info', (_req: Request, res: Response) => {
  const info = downloadService.getQueueInfo();
  res.json(info);
});

// ============================================
// Batch Queue Operations
// ============================================

// Pause all queued downloads
router.post('/queue/pause-all', (_req: Request, res: Response) => {
  const result = downloadService.pauseAllQueued();
  res.json(result);
});

// Resume all paused downloads
router.post('/queue/resume-all', (_req: Request, res: Response) => {
  const result = downloadService.resumeAllPaused();
  res.json(result);
});

// Clear all completed/failed/cancelled downloads
router.delete('/queue/clear-completed', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await downloadService.clearCompleted();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================
// Cache Management - List completed downloads on disk
// ============================================

interface CachedFile {
  id: string;
  filename: string;
  title: string;
  size: number;
  sizeFormatted: string;
  createdAt: Date;
  path: string;
  // Parsed info for movies vs shows
  type: 'movie' | 'episode';
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeName?: string;
  // Video metadata from ffprobe
  videoInfo?: {
    resolution: string;      // e.g., "1920x1080"
    resolutionLabel: string; // e.g., "1080p"
    codec: string;           // e.g., "h264" or "hevc"
    codecLabel: string;      // e.g., "H.264" or "HEVC"
    bitrate?: number;        // in kbps
    bitrateFormatted?: string; // e.g., "5.2 Mbps"
    duration?: number;       // in seconds
    durationFormatted?: string; // e.g., "1:42:30"
    frameRate?: string;      // e.g., "23.976"
    audioCodec?: string;     // e.g., "aac"
    audioChannels?: number;  // e.g., 2 or 6
  };
  // Retention info
  retention?: {
    retentionDays: number | null;  // null = uses global default
    effectiveDays: number | null;  // Resolved days (from override or global)
    expiresAt: Date | null;        // null = forever
    isOverride: boolean;           // true if per-file override is set
  };
}

// Get video metadata using ffprobe
async function getVideoMetadata(filePath: string): Promise<CachedFile['videoInfo']> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 10000 }
    );

    const data = JSON.parse(stdout);
    const videoStream = data.streams?.find((s: any) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
    const format = data.format;

    if (!videoStream) return undefined;

    const width = videoStream.width || 0;
    const height = videoStream.height || 0;
    const codec = videoStream.codec_name || 'unknown';
    const bitrate = format?.bit_rate ? Math.round(parseInt(format.bit_rate) / 1000) : undefined;
    const duration = format?.duration ? parseFloat(format.duration) : undefined;

    // Determine resolution label
    let resolutionLabel = `${height}p`;
    if (height >= 2160) resolutionLabel = '4K';
    else if (height >= 1440) resolutionLabel = '1440p';
    else if (height >= 1080) resolutionLabel = '1080p';
    else if (height >= 720) resolutionLabel = '720p';
    else if (height >= 480) resolutionLabel = '480p';
    else resolutionLabel = `${height}p`;

    // Codec label
    const codecLabel = codec === 'hevc' || codec === 'h265' ? 'HEVC' :
                       codec === 'h264' || codec === 'avc1' ? 'H.264' :
                       codec.toUpperCase();

    // Format bitrate
    let bitrateFormatted: string | undefined;
    if (bitrate) {
      bitrateFormatted = bitrate >= 1000 ? `${(bitrate / 1000).toFixed(1)} Mbps` : `${bitrate} kbps`;
    }

    // Format duration
    let durationFormatted: string | undefined;
    if (duration) {
      const hours = Math.floor(duration / 3600);
      const mins = Math.floor((duration % 3600) / 60);
      const secs = Math.floor(duration % 60);
      durationFormatted = hours > 0
        ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        : `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    return {
      resolution: `${width}x${height}`,
      resolutionLabel,
      codec,
      codecLabel,
      bitrate,
      bitrateFormatted,
      duration,
      durationFormatted,
      frameRate: videoStream.r_frame_rate,
      audioCodec: audioStream?.codec_name,
      audioChannels: audioStream?.channels
    };
  } catch (err) {
    // ffprobe not available or failed
    return undefined;
  }
}

// Parse title to extract show info
// Format: "Series Name - S01E02 - Episode Name" or just "Movie Name"
function parseCachedTitle(title: string): {
  type: 'movie' | 'episode';
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeName?: string;
} {
  // Match pattern like "Show Name - S01E02 - Episode Title"
  const showMatch = title.match(/^(.+?)\s*-\s*S(\d+)E(\d+)\s*-\s*(.+)$/i);
  if (showMatch) {
    return {
      type: 'episode',
      seriesName: showMatch[1].trim(),
      seasonNumber: parseInt(showMatch[2], 10),
      episodeNumber: parseInt(showMatch[3], 10),
      episodeName: showMatch[4].trim()
    };
  }

  // Also match pattern like "Show Name - S01E02" (no episode name)
  const showMatchShort = title.match(/^(.+?)\s*-\s*S(\d+)E(\d+)$/i);
  if (showMatchShort) {
    return {
      type: 'episode',
      seriesName: showMatchShort[1].trim(),
      seasonNumber: parseInt(showMatchShort[2], 10),
      episodeNumber: parseInt(showMatchShort[3], 10)
    };
  }

  // It's a movie
  return { type: 'movie' };
}

// List all cached (completed) downloads from disk
router.get('/cache', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached: CachedFile[] = [];
    const downloadsDir = settingsService.get('downloadsDir');

    // Scan downloads directory
    let dirs: string[] = [];
    try {
      dirs = await fsp.readdir(downloadsDir);
    } catch {
      // Downloads dir might not exist
      return res.json({ cached: [] });
    }

    // First pass: gather all files
    const filesToProbe: { file: CachedFile; filePath: string }[] = [];

    for (const dir of dirs) {
      const dirPath = path.join(downloadsDir, dir);

      try {
        const stat = await fsp.stat(dirPath);
        if (!stat.isDirectory()) continue;

        // Find MP4 files in this directory
        const files = await fsp.readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith('.mp4')) continue;

          const filePath = path.join(dirPath, file);
          const fileStat = await fsp.stat(filePath);

          // Skip tiny/broken files
          if (fileStat.size < 1000) continue;

          const title = file.replace('.mp4', '');
          const parsed = parseCachedTitle(title);

          const cachedFile: CachedFile = {
            id: dir,
            filename: file,
            title,
            size: fileStat.size,
            sizeFormatted: formatBytes(fileStat.size),
            createdAt: fileStat.mtime,
            path: filePath,
            ...parsed
          };

          filesToProbe.push({ file: cachedFile, filePath });
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    // Second pass: probe all files in parallel for video metadata and retention info
    await Promise.all(
      filesToProbe.map(async ({ file, filePath }) => {
        // Get video metadata
        file.videoInfo = await getVideoMetadata(filePath);

        // Get retention info
        try {
          const retentionInfo = await retentionService.getEffectiveRetention(file.id);
          file.retention = {
            retentionDays: retentionInfo.retentionDays,
            effectiveDays: retentionInfo.effectiveDays,
            expiresAt: retentionInfo.expiresAt,
            isOverride: retentionInfo.isOverride
          };
        } catch {
          // If retention fetch fails, leave it undefined
        }

        cached.push(file);
      })
    );

    // Sort by creation date, newest first
    cached.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json({ cached });
  } catch (err) {
    next(err);
  }
});

// Stream a cached file
router.get('/cache/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const downloadsDir = settingsService.get('downloadsDir');
    const dirPath = path.join(downloadsDir, req.params.id);

    // Find the MP4 file
    const files = await fsp.readdir(dirPath);
    const mp4File = files.find(f => f.endsWith('.mp4'));

    if (!mp4File) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = path.join(dirPath, mp4File);

    res.sendFile(filePath, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${mp4File}"`
      }
    });
  } catch (err) {
    next(err);
  }
});

// Delete a cached file
router.delete('/cache/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const downloadsDir = settingsService.get('downloadsDir');
    const dirPath = path.join(downloadsDir, req.params.id);

    // Security check - make sure it's within downloads dir
    const resolved = path.resolve(dirPath);
    if (!resolved.startsWith(path.resolve(downloadsDir))) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    await fsp.rm(dirPath, { recursive: true, force: true });
    logger.info(`Deleted cached download: ${req.params.id}`);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Update retention for a cached file
router.patch('/cache/:id/retention', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { retentionDays } = req.body;

    // Validate input
    if (retentionDays !== null && retentionDays !== undefined) {
      if (typeof retentionDays !== 'number' || retentionDays < 1 || retentionDays > 365 || !Number.isInteger(retentionDays)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'retentionDays must be null (forever) or an integer between 1 and 365'
        });
      }
    }

    const downloadsDir = settingsService.get('downloadsDir');
    const dirPath = path.join(downloadsDir, req.params.id);

    // Security check - make sure it's within downloads dir
    const resolved = path.resolve(dirPath);
    if (!resolved.startsWith(path.resolve(downloadsDir))) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    // Verify directory exists
    try {
      await fsp.access(dirPath);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    const meta = await retentionService.updateRetention(req.params.id, retentionDays ?? null);

    logger.info(`Updated retention for ${req.params.id}: ${retentionDays === null || retentionDays === undefined ? 'forever' : retentionDays + ' days'}`);

    res.json({
      success: true,
      retention: {
        retentionDays: meta.retentionDays,
        expiresAt: meta.expiresAt
      }
    });
  } catch (err) {
    next(err);
  }
});

// Helper function
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default router;
