import { Router, Request, Response, NextFunction } from 'express';
import fsp from 'fs/promises';
import path from 'path';
import { requireAuth } from '../middleware/auth.middleware';
import { createJellyfinService } from '../services/jellyfin.service';
import { downloadService } from '../services/download.service';
import { TRANSCODE_PRESETS } from '../models/types';
import { config } from '../config';
import { logger } from '../index';

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
  const presets = Object.entries(TRANSCODE_PRESETS).map(([key, value]) => ({
    id: key,
    name: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
    resolution: value.maxWidth <= 854 ? '480p' :
                value.maxWidth <= 1280 ? '720p' :
                value.maxWidth <= 1920 ? '1080p' : '4K',
    bitrate: value.maxBitrate,
    bitrateFormatted: `${(value.maxBitrate / 1_000_000).toFixed(1)} Mbps`,
    estimatedSizePerHour: Math.round(((value.maxBitrate + value.audioBitrate) * 3600) / 8 / 1_000_000) // MB per hour
  }));

  res.json({ presets });
});

// Start a download
router.post('/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { itemId, mediaSourceId, preset, audioStreamIndex } = req.body;

    logger.info(`Download request received: itemId=${itemId}, preset=${preset}`);

    if (!itemId || !preset) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'itemId and preset are required'
      });
    }

    const transcodeSettings = TRANSCODE_PRESETS[preset];
    if (!transcodeSettings) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid preset: ${preset}. Valid options: ${Object.keys(TRANSCODE_PRESETS).join(', ')}`
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

    // Calculate expected duration in seconds
    const durationSeconds = item.RunTimeTicks
      ? item.RunTimeTicks / 10_000_000
      : 7200; // Default 2 hours if unknown

    // Build HLS URL
    const hlsUrl = jellyfin.buildHLSUrl(itemId, sourceId, transcodeSettings, audioIndex);

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

    // Start download
    const session = await downloadService.startDownload(
      itemId,
      sourceId,
      title,
      hlsUrl,
      durationSeconds,
      transcodeSettings
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
}

// List all cached (completed) downloads from disk
router.get('/cache', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cached: CachedFile[] = [];

    // Scan downloads directory
    let dirs: string[] = [];
    try {
      dirs = await fsp.readdir(config.downloadsDir);
    } catch {
      // Downloads dir might not exist
      return res.json({ cached: [] });
    }

    for (const dir of dirs) {
      const dirPath = path.join(config.downloadsDir, dir);

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

          cached.push({
            id: dir,
            filename: file,
            title: file.replace('.mp4', ''),
            size: fileStat.size,
            sizeFormatted: formatBytes(fileStat.size),
            createdAt: fileStat.mtime,
            path: filePath
          });
        }
      } catch {
        // Skip inaccessible directories
      }
    }

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
    const dirPath = path.join(config.downloadsDir, req.params.id);

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
    const dirPath = path.join(config.downloadsDir, req.params.id);

    // Security check - make sure it's within downloads dir
    const resolved = path.resolve(dirPath);
    if (!resolved.startsWith(path.resolve(config.downloadsDir))) {
      return res.status(403).json({ error: 'Invalid path' });
    }

    await fsp.rm(dirPath, { recursive: true, force: true });
    logger.info(`Deleted cached download: ${req.params.id}`);

    res.json({ success: true });
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
