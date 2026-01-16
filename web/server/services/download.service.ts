import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { Response } from 'express';
import { DownloadSession, DownloadProgress, DownloadState, TranscodeSettings, HLSSegment } from '../models/types';
import { hlsParser } from './hls-parser.service';
import { segmentService } from './segment.service';
import { config } from '../config';
import { logger } from '../index';
import { settingsService } from './settings.service';
import { retentionService } from './retention.service';

type ProgressCallback = (progress: DownloadProgress) => void;

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000; // 5 seconds between retries

export class DownloadService {
  private sessions: Map<string, DownloadSession> = new Map();
  private progressCallbacks: Map<string, Set<ProgressCallback>> = new Map();

  // Queue management
  private activeDownloads: Set<string> = new Set();
  private downloadQueue: string[] = []; // Ordered session IDs

  // Initialization state
  private initialized = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Initialization is now deferred to initialize() method
  }

  // Initialize the service - must be called before use
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load settings first
    await settingsService.load();

    // Restore any resumable sessions
    await this.restoreResumableSessions().catch(err => {
      logger.warn(`Failed to restore sessions: ${err.message}`);
    });

    // Start periodic cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions().catch(err => {
        logger.warn(`Failed to cleanup stale sessions: ${err.message}`);
      });
    }, 60 * 60 * 1000); // 1 hour

    this.initialized = true;
    logger.info('Download service initialized');
  }

  // Shutdown cleanup
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // Start a new download (adds to queue)
  async startDownload(
    itemId: string,
    mediaSourceId: string,
    title: string,
    hlsUrl: string,
    expectedDurationSeconds: number,
    transcodeSettings: TranscodeSettings,
    softSubtitle?: DownloadSession['softSubtitle']
  ): Promise<DownloadSession> {
    // Validate transcodeSettings
    this.validateTranscodeSettings(transcodeSettings);

    const sessionId = uuidv4();
    const tempDir = path.join(config.tempDir, sessionId);

    // Create safe filename
    const safeTitle = title.replace(/[^a-zA-Z0-9\s\-_.]/g, '').trim();
    const filename = `${safeTitle}.mp4`;

    const session: DownloadSession = {
      id: sessionId,
      itemId,
      mediaSourceId,
      title,
      filename,
      status: 'queued', // Start as queued
      progress: 0,
      completedSegments: 0,
      totalSegments: 0,
      tempDir,
      segmentPaths: [],
      hlsUrl,
      createdAt: new Date(),
      transcodeSettings,
      expectedDurationSeconds,
      completedSegmentIndexes: new Set(),
      queuedAt: new Date(),
      bytesDownloaded: 0,
      softSubtitle
    };

    this.sessions.set(sessionId, session);

    // Add to queue
    this.downloadQueue.push(sessionId);
    this.updateQueuePositions();
    this.emitProgress(session);

    // Try to start processing
    this.processQueue();

    return session;
  }

  // Process queue - start downloads if slots available
  private async processQueue(): Promise<void> {
    const maxConcurrent = settingsService.get('maxConcurrentDownloads');

    while (this.activeDownloads.size < maxConcurrent && this.downloadQueue.length > 0) {
      // Find next non-paused session in queue
      let nextId: string | undefined;
      let queueIndex = -1;

      for (let i = 0; i < this.downloadQueue.length; i++) {
        const id = this.downloadQueue[i];
        const session = this.sessions.get(id);
        if (session && session.status === 'queued') {
          nextId = id;
          queueIndex = i;
          break;
        }
      }

      if (!nextId || queueIndex === -1) break;

      // Remove from queue
      this.downloadQueue.splice(queueIndex, 1);

      const session = this.sessions.get(nextId)!;
      this.activeDownloads.add(nextId);
      session.status = 'transcoding';
      session.queuePosition = undefined;
      this.emitProgress(session);

      // Start processing in background
      this.processDownload(session)
        .catch(async (err) => {
          const retryCount = (session.retryCount || 0) + 1;
          session.lastError = err.message;

          if (retryCount <= MAX_RETRIES) {
            // Retry the download
            logger.warn(`Download failed for ${session.title} (attempt ${retryCount}/${MAX_RETRIES}): ${err.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
            session.retryCount = retryCount;
            session.status = 'queued';
            session.error = `Retry ${retryCount}/${MAX_RETRIES}: ${err.message}`;
            this.emitProgress(session);

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

            // Re-add to front of queue for retry
            this.downloadQueue.unshift(session.id);
            this.updateQueuePositions();
          } else {
            // Max retries exceeded, mark as failed
            logger.error(`Download permanently failed for ${session.title} after ${MAX_RETRIES} retries: ${err.message}`);
            session.status = 'failed';
            session.error = `Failed after ${MAX_RETRIES} retries: ${err.message}`;
            this.saveState(session).catch(() => {});
            this.emitProgress(session);
          }
        })
        .finally(() => {
          this.activeDownloads.delete(nextId!);
          this.updateQueuePositions();
          this.processQueue(); // Process next in queue
        });
    }

    this.updateQueuePositions();
  }

  // Update queue positions for all queued sessions
  private updateQueuePositions(): void {
    let position = 1;
    for (const id of this.downloadQueue) {
      const session = this.sessions.get(id);
      if (session && (session.status === 'queued' || session.status === 'paused')) {
        session.queuePosition = position++;
        this.emitProgress(session);
      }
    }
  }

  // Pause an active or queued download
  async pauseDownload(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Download session not found');
    }

    if (session.status === 'completed' || session.status === 'cancelled') {
      throw new Error(`Cannot pause download with status: ${session.status}`);
    }

    // If active, it will continue to completion but won't auto-start new ones
    // For queued items, mark as paused
    if (session.status === 'queued') {
      session.status = 'paused';
      session.pausedAt = new Date();
      this.emitProgress(session);
    } else if (this.activeDownloads.has(sessionId)) {
      // Can't really pause an active transcode, but we can mark it
      // It will complete but status shows paused intent
      session.pausedAt = new Date();
      // Note: Actual pause of active download would require more complex handling
      // For now, we just let it complete
    }

    this.updateQueuePositions();
  }

  // Resume a paused download
  async resumePausedDownload(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Download session not found');
    }

    if (session.status !== 'paused') {
      throw new Error(`Cannot resume download with status: ${session.status}`);
    }

    session.status = 'queued';
    session.pausedAt = undefined;

    // Move to back of queue
    const idx = this.downloadQueue.indexOf(sessionId);
    if (idx === -1) {
      this.downloadQueue.push(sessionId);
    }

    this.updateQueuePositions();
    this.emitProgress(session);
    this.processQueue();
  }

  // Move a queued download to front of queue
  async moveToFront(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Download session not found');
    }

    if (session.status !== 'queued' && session.status !== 'paused') {
      throw new Error('Can only reorder queued downloads');
    }

    const idx = this.downloadQueue.indexOf(sessionId);
    if (idx > 0) {
      this.downloadQueue.splice(idx, 1);
      this.downloadQueue.unshift(sessionId);
      this.updateQueuePositions();
    }
  }

  // Move a queued download to a specific position
  async reorderQueue(sessionId: string, newPosition: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Download session not found');
    }

    if (session.status !== 'queued' && session.status !== 'paused') {
      throw new Error('Can only reorder queued downloads');
    }

    const idx = this.downloadQueue.indexOf(sessionId);
    if (idx === -1) return;

    // Remove from current position
    this.downloadQueue.splice(idx, 1);

    // Insert at new position (0-based)
    const insertIdx = Math.max(0, Math.min(newPosition - 1, this.downloadQueue.length));
    this.downloadQueue.splice(insertIdx, 0, sessionId);

    this.updateQueuePositions();
  }

  // Process the download
  private async processDownload(session: DownloadSession): Promise<void> {
    try {
      // Parse master playlist to get media playlist URL
      const masterPlaylist = await hlsParser.parseMasterPlaylist(session.hlsUrl!);
      session.mediaPlaylistUrl = masterPlaylist.mediaPlaylistUrl;

      logger.info(`[${session.id}] Starting download for "${session.title}"`);
      this.updateSession(session.id, {
        status: 'downloading',
        downloadStartedAt: new Date()
      });

      // Fetch playlist
      const mediaPlaylist = await hlsParser.parseMediaPlaylist(masterPlaylist.mediaPlaylistUrl);
      logger.info(`[${session.id}] Playlist: ${mediaPlaylist.segments.length} segments, ${Math.round(mediaPlaylist.totalDuration)}s total`);

      // DOWNLOAD PHASE
      logger.info(`[${session.id}] Starting segment downloads`);

      const totalSegments = mediaPlaylist.segments.length + (mediaPlaylist.initSegmentUrl ? 1 : 0);
      session.segments = mediaPlaylist.segments;

      this.updateSession(session.id, {
        status: 'downloading',
        totalSegments,
        initSegmentPath: undefined,
        segmentPaths: []
      });

      // Save state before starting downloads
      await this.saveState(session);

      // Download all segments
      const result = await segmentService.downloadSegments(
        mediaPlaylist.segments,
        mediaPlaylist.initSegmentUrl,
        session.tempDir,
        (completed, total, bytesDownloaded) => {
          const progress = completed / total;
          this.updateSession(session.id, {
            progress,
            completedSegments: completed,
            bytesDownloaded
          });
        },
        async (segmentIndex) => {
          session.completedSegmentIndexes.add(segmentIndex);
          await this.saveState(session);
        },
        session.completedSegmentIndexes
      );

      logger.info(`[${session.id}] All segments downloaded`);

      // FINALIZE PHASE
      this.updateSession(session.id, {
        status: 'processing',
        initSegmentPath: result.initSegmentPath,
        segmentPaths: result.segmentPaths
      });

      const downloadsDir = settingsService.get('downloadsDir');
      const finalPath = path.join(downloadsDir, session.id, session.filename);

      logger.info(`[${session.id}] Muxing with ffmpeg to: ${finalPath}`);

      await segmentService.concatenateWithFfmpeg(
        result.initSegmentPath,
        result.segmentPaths,
        finalPath
      );

      // Handle soft subtitles if present
      if (session.softSubtitle) {
        logger.info(`[${session.id}] Fetching soft subtitle (stream ${session.softSubtitle.streamIndex})`);

        const subtitlePath = await segmentService.fetchSubtitle(
          session.softSubtitle.jellyfinUrl,
          session.softSubtitle.accessToken,
          session.itemId,
          session.mediaSourceId,
          session.softSubtitle.streamIndex,
          session.tempDir
        );

        if (subtitlePath) {
          logger.info(`[${session.id}] Muxing subtitle into video`);
          const videoWithSubsPath = finalPath.replace('.mp4', '.subs.mp4');

          await segmentService.muxWithSubtitle(
            finalPath,
            subtitlePath,
            videoWithSubsPath,
            session.softSubtitle.language
          );

          // Replace original with subtitled version
          await fsp.unlink(finalPath);
          await fsp.rename(videoWithSubsPath, finalPath);
          logger.info(`[${session.id}] Soft subtitle muxing complete`);
        } else {
          logger.warn(`[${session.id}] Failed to fetch soft subtitle, video will be without subtitles`);
        }
      }

      const stat = await fsp.stat(finalPath);
      const totalSize = stat.size;

      this.updateSession(session.id, {
        status: 'completed',
        progress: 1,
        totalSize,
        finalPath
      });

      logger.info(`[${session.id}] Download complete: ${Math.round(totalSize / 1024 / 1024)}MB`);

      // Create retention metadata for the completed download
      await retentionService.createRetentionMeta(session.id).catch(err => {
        logger.warn(`[${session.id}] Failed to create retention metadata: ${err.message}`);
      });

      await segmentService.cleanup(session.tempDir);
      await this.deleteState(session.id);

    } catch (err) {
      this.updateSession(session.id, {
        status: 'failed',
        error: (err as Error).message
      });
      throw err;
    }
  }

  // Resume a failed download
  async resumeDownload(sessionId: string): Promise<DownloadSession> {
    let session: DownloadSession | undefined = this.sessions.get(sessionId);

    if (!session) {
      const loadedSession = await this.loadState(sessionId);
      if (!loadedSession) {
        throw new Error('Download session not found and no state file available');
      }
      session = loadedSession;
      this.sessions.set(sessionId, session);
    }

    if (session.status !== 'failed') {
      throw new Error(`Cannot resume download with status: ${session.status}`);
    }

    logger.info(`[${sessionId}] Resuming download for "${session.title}" (${session.completedSegmentIndexes.size} segments already done)`);

    // Add to queue instead of immediate start
    session.status = 'queued';
    session.error = undefined;
    session.queuedAt = new Date();

    this.downloadQueue.push(sessionId);
    this.updateQueuePositions();
    this.emitProgress(session);
    this.processQueue();

    return session;
  }

  // Continue downloading from where we left off (called by processQueue for resumed sessions)
  private async continueDownload(session: DownloadSession): Promise<void> {
    try {
      if (!session.segments || session.segments.length === 0) {
        if (!session.mediaPlaylistUrl) {
          throw new Error('No media playlist URL available for resume');
        }
        const mediaPlaylist = await hlsParser.parseMediaPlaylist(session.mediaPlaylistUrl);
        session.segments = mediaPlaylist.segments;
        session.totalSegments = mediaPlaylist.segments.length + (mediaPlaylist.initSegmentUrl ? 1 : 0);
      }

      logger.info(`[${session.id}] Resuming: ${session.completedSegmentIndexes.size}/${session.totalSegments} segments already downloaded`);

      // Set download start time for resumed downloads
      this.updateSession(session.id, { downloadStartedAt: new Date() });

      const result = await segmentService.downloadSegments(
        session.segments,
        undefined,
        session.tempDir,
        (completed, total, bytesDownloaded) => {
          const progress = completed / total;
          this.updateSession(session.id, {
            progress,
            completedSegments: completed,
            bytesDownloaded
          });
        },
        async (segmentIndex) => {
          session.completedSegmentIndexes.add(segmentIndex);
          await this.saveState(session);
        },
        session.completedSegmentIndexes
      );

      const initPath = result.initSegmentPath || path.join(session.tempDir, 'init.mp4');
      this.updateSession(session.id, {
        status: 'processing',
        initSegmentPath: initPath,
        segmentPaths: result.segmentPaths
      });

      const downloadsDir = settingsService.get('downloadsDir');
      const finalPath = path.join(downloadsDir, session.id, session.filename);

      logger.info(`[${session.id}] Muxing resumed download with ffmpeg to: ${finalPath}`);

      await segmentService.concatenateWithFfmpeg(
        initPath,
        result.segmentPaths,
        finalPath
      );

      // Handle soft subtitles if present
      if (session.softSubtitle) {
        logger.info(`[${session.id}] Fetching soft subtitle for resumed download (stream ${session.softSubtitle.streamIndex})`);

        const subtitlePath = await segmentService.fetchSubtitle(
          session.softSubtitle.jellyfinUrl,
          session.softSubtitle.accessToken,
          session.itemId,
          session.mediaSourceId,
          session.softSubtitle.streamIndex,
          session.tempDir
        );

        if (subtitlePath) {
          logger.info(`[${session.id}] Muxing subtitle into resumed video`);
          const videoWithSubsPath = finalPath.replace('.mp4', '.subs.mp4');

          await segmentService.muxWithSubtitle(
            finalPath,
            subtitlePath,
            videoWithSubsPath,
            session.softSubtitle.language
          );

          // Replace original with subtitled version
          await fsp.unlink(finalPath);
          await fsp.rename(videoWithSubsPath, finalPath);
          logger.info(`[${session.id}] Soft subtitle muxing complete`);
        } else {
          logger.warn(`[${session.id}] Failed to fetch soft subtitle, video will be without subtitles`);
        }
      }

      const stat = await fsp.stat(finalPath);
      const totalSize = stat.size;

      this.updateSession(session.id, {
        status: 'completed',
        progress: 1,
        totalSize,
        finalPath
      });

      logger.info(`[${session.id}] Resume complete: ${Math.round(totalSize / 1024 / 1024)}MB`);

      // Create retention metadata for the completed download
      await retentionService.createRetentionMeta(session.id).catch(err => {
        logger.warn(`[${session.id}] Failed to create retention metadata: ${err.message}`);
      });

      await segmentService.cleanup(session.tempDir);
      await this.deleteState(session.id);

    } catch (err) {
      this.updateSession(session.id, {
        status: 'failed',
        error: (err as Error).message
      });
      throw err;
    }
  }

  // Save session state to disk for resume
  private async saveState(session: DownloadSession): Promise<void> {
    try {
      await fsp.mkdir(session.tempDir, { recursive: true });
      const statePath = path.join(session.tempDir, 'state.json');

      const state: DownloadState = {
        sessionId: session.id,
        itemId: session.itemId,
        mediaSourceId: session.mediaSourceId,
        title: session.title,
        filename: session.filename,
        hlsUrl: session.hlsUrl || '',
        mediaPlaylistUrl: session.mediaPlaylistUrl,
        status: session.status,
        totalSegments: session.totalSegments,
        completedSegmentIndexes: Array.from(session.completedSegmentIndexes),
        segments: session.segments || [],
        expectedDurationSeconds: session.expectedDurationSeconds,
        transcodeSettings: session.transcodeSettings,
        createdAt: session.createdAt.toISOString(),
        updatedAt: new Date().toISOString()
      };

      await fsp.writeFile(statePath, JSON.stringify(state, null, 2));
    } catch (err) {
      logger.warn(`Failed to save state for ${session.id}: ${(err as Error).message}`);
    }
  }

  // Load session state from disk
  private async loadState(sessionId: string): Promise<DownloadSession | null> {
    try {
      const statePath = path.join(config.tempDir, sessionId, 'state.json');
      const content = await fsp.readFile(statePath, 'utf-8');
      const state: DownloadState = JSON.parse(content);

      const session: DownloadSession = {
        id: state.sessionId,
        itemId: state.itemId,
        mediaSourceId: state.mediaSourceId,
        title: state.title,
        filename: state.filename,
        status: state.status,
        progress: state.completedSegmentIndexes.length / state.totalSegments,
        completedSegments: state.completedSegmentIndexes.length,
        totalSegments: state.totalSegments,
        tempDir: path.join(config.tempDir, sessionId),
        segmentPaths: [],
        hlsUrl: state.hlsUrl,
        mediaPlaylistUrl: state.mediaPlaylistUrl,
        createdAt: new Date(state.createdAt),
        transcodeSettings: state.transcodeSettings,
        expectedDurationSeconds: state.expectedDurationSeconds,
        completedSegmentIndexes: new Set(state.completedSegmentIndexes),
        segments: state.segments,
        bytesDownloaded: 0 // Will be recalculated on resume
      };

      return session;
    } catch {
      return null;
    }
  }

  // Delete state file
  private async deleteState(sessionId: string): Promise<void> {
    try {
      const statePath = path.join(config.tempDir, sessionId, 'state.json');
      await fsp.unlink(statePath);
    } catch {
      // Ignore if doesn't exist
    }
  }

  // Restore resumable sessions on startup
  private async restoreResumableSessions(): Promise<void> {
    try {
      const tempDirs = await fsp.readdir(config.tempDir);

      for (const dir of tempDirs) {
        const statePath = path.join(config.tempDir, dir, 'state.json');
        try {
          await fsp.access(statePath);
          const session = await this.loadState(dir);
          if (session && session.status === 'failed') {
            logger.info(`Found resumable session: ${session.title} (${session.completedSegments}/${session.totalSegments} segments)`);
            this.sessions.set(session.id, session);
          }
        } catch {
          // No state file, skip
        }
      }
    } catch {
      // Temp dir might not exist yet
    }
  }

  // Stream completed download to response
  async streamToResponse(sessionId: string, res: Response, _rangeHeader?: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error('Download session not found');
    }

    if (session.status !== 'completed') {
      throw new Error(`Download not ready: ${session.status}`);
    }

    if (!session.finalPath) {
      throw new Error('Final file not found');
    }

    return new Promise((resolve, reject) => {
      res.sendFile(session.finalPath!, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${session.filename}"`
        }
      }, (err) => {
        if (err) {
          if ((err as NodeJS.ErrnoException).code === 'ECONNABORTED') {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  }

  // Get final file path for a completed download
  getFinalPath(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'completed' || !session.finalPath) {
      return null;
    }
    return session.finalPath;
  }

  // Cancel a download
  async cancelDownload(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Remove from queue if queued
    const queueIdx = this.downloadQueue.indexOf(sessionId);
    if (queueIdx !== -1) {
      this.downloadQueue.splice(queueIdx, 1);
    }

    // Remove from active if active
    this.activeDownloads.delete(sessionId);

    session.status = 'cancelled';
    session.queuePosition = undefined;
    this.emitProgress(session);

    await this.cleanup(sessionId);
    this.updateQueuePositions();
  }

  // Cancel/remove multiple downloads by their original item IDs
  async cancelByItemIds(itemIds: string[]): Promise<{ cancelled: number; removed: number }> {
    const itemIdSet = new Set(itemIds);
    let cancelled = 0;
    let removed = 0;

    // Find all sessions matching these item IDs
    const sessionsToProcess: DownloadSession[] = [];
    for (const session of this.sessions.values()) {
      if (itemIdSet.has(session.itemId)) {
        sessionsToProcess.push(session);
      }
    }

    for (const session of sessionsToProcess) {
      if (session.status === 'queued' || session.status === 'paused') {
        // Remove from queue
        const queueIdx = this.downloadQueue.indexOf(session.id);
        if (queueIdx !== -1) {
          this.downloadQueue.splice(queueIdx, 1);
        }
        await this.cleanup(session.id);
        cancelled++;
      } else if (session.status === 'downloading' || session.status === 'processing' || session.status === 'transcoding') {
        // Cancel active download
        this.activeDownloads.delete(session.id);
        session.status = 'cancelled';
        session.queuePosition = undefined;
        this.emitProgress(session);
        await this.cleanup(session.id);
        cancelled++;
      } else if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
        // Remove completed/failed
        await this.cleanup(session.id);
        removed++;
      }
    }

    this.updateQueuePositions();
    return { cancelled, removed };
  }

  // Remove a failed/completed download from the list
  async removeDownload(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Can remove queued, paused, failed, completed, or cancelled
    if (session.status === 'downloading' || session.status === 'processing' || session.status === 'transcoding') {
      return false;
    }

    // Remove from queue if present
    const queueIdx = this.downloadQueue.indexOf(sessionId);
    if (queueIdx !== -1) {
      this.downloadQueue.splice(queueIdx, 1);
    }

    await this.cleanup(sessionId);
    this.updateQueuePositions();
    return true;
  }

  // Cleanup session
  async cleanup(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    await segmentService.cleanup(session.tempDir);

    if (session.finalPath) {
      const downloadDir = path.dirname(session.finalPath);
      try {
        await fsp.rm(downloadDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    this.sessions.delete(sessionId);
    this.progressCallbacks.delete(sessionId);
  }

  // Get session
  getSession(sessionId: string): DownloadSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Get all downloads
  getAllDownloads(): DownloadProgress[] {
    const downloads: DownloadProgress[] = [];
    for (const session of this.sessions.values()) {
      downloads.push({
        sessionId: session.id,
        title: session.title,
        filename: session.filename,
        status: session.status,
        progress: session.progress,
        completedSegments: session.completedSegments,
        totalSegments: session.totalSegments,
        error: session.error,
        createdAt: session.createdAt,
        canResume: session.status === 'failed' && session.completedSegmentIndexes.size > 0,
        queuePosition: session.queuePosition,
        bytesDownloaded: session.bytesDownloaded,
        downloadStartedAt: session.downloadStartedAt
      });
    }

    // Sort: active first, then queued by position, then others by date
    return downloads.sort((a, b) => {
      const statusOrder: Record<string, number> = {
        transcoding: 0,
        downloading: 0,
        processing: 0,
        queued: 1,
        paused: 2,
        completed: 3,
        failed: 4,
        cancelled: 5
      };

      const orderA = statusOrder[a.status] ?? 99;
      const orderB = statusOrder[b.status] ?? 99;

      if (orderA !== orderB) return orderA - orderB;

      // For queued items, sort by queue position
      if (a.queuePosition && b.queuePosition) {
        return a.queuePosition - b.queuePosition;
      }

      // Otherwise by date
      return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
    });
  }

  // Get progress
  getProgress(sessionId: string): DownloadProgress | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId: session.id,
      status: session.status,
      progress: session.progress,
      completedSegments: session.completedSegments,
      totalSegments: session.totalSegments,
      error: session.error,
      canResume: session.status === 'failed' && session.completedSegmentIndexes.size > 0,
      queuePosition: session.queuePosition,
      bytesDownloaded: session.bytesDownloaded,
      downloadStartedAt: session.downloadStartedAt
    };
  }

  // Subscribe to progress updates
  onProgress(sessionId: string, callback: ProgressCallback): () => void {
    if (!this.progressCallbacks.has(sessionId)) {
      this.progressCallbacks.set(sessionId, new Set());
    }
    this.progressCallbacks.get(sessionId)!.add(callback);

    return () => {
      this.progressCallbacks.get(sessionId)?.delete(callback);
    };
  }

  // Update session and emit progress
  private updateSession(sessionId: string, updates: Partial<DownloadSession>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    Object.assign(session, updates);
    this.emitProgress(session);
  }

  // Emit progress to all subscribers
  private emitProgress(session: DownloadSession): void {
    const callbacks = this.progressCallbacks.get(session.id);
    if (!callbacks) return;

    const progress: DownloadProgress = {
      sessionId: session.id,
      status: session.status,
      progress: session.progress,
      completedSegments: session.completedSegments,
      totalSegments: session.totalSegments,
      error: session.error,
      canResume: session.status === 'failed' && session.completedSegmentIndexes.size > 0,
      queuePosition: session.queuePosition,
      bytesDownloaded: session.bytesDownloaded,
      downloadStartedAt: session.downloadStartedAt
    };

    callbacks.forEach(cb => cb(progress));
  }

  // Validate transcode settings
  private validateTranscodeSettings(settings: TranscodeSettings): void {
    if (!settings || typeof settings !== 'object') {
      throw new Error('transcodeSettings is required');
    }

    // Validate maxWidth
    if (typeof settings.maxWidth !== 'number' || settings.maxWidth < 320 || settings.maxWidth > 7680) {
      throw new Error('maxWidth must be a number between 320 and 7680');
    }

    // Validate maxBitrate
    if (typeof settings.maxBitrate !== 'number' || settings.maxBitrate < 100_000 || settings.maxBitrate > 100_000_000) {
      throw new Error('maxBitrate must be a number between 100000 and 100000000');
    }

    // Validate videoCodec
    const validVideoCodecs = ['h264', 'hevc'];
    if (typeof settings.videoCodec !== 'string' || !validVideoCodecs.includes(settings.videoCodec)) {
      throw new Error('videoCodec must be h264 or hevc');
    }

    // Validate audioCodec
    if (typeof settings.audioCodec !== 'string' || settings.audioCodec !== 'aac') {
      throw new Error('audioCodec must be aac');
    }

    // Validate audioBitrate
    if (typeof settings.audioBitrate !== 'number' || settings.audioBitrate < 32_000 || settings.audioBitrate > 640_000) {
      throw new Error('audioBitrate must be a number between 32000 and 640000');
    }

    // Validate audioChannels
    if (typeof settings.audioChannels !== 'number' || ![2, 6].includes(settings.audioChannels)) {
      throw new Error('audioChannels must be 2 or 6');
    }
  }

  // Cleanup stale sessions and expired files based on retention settings
  async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    // Clean up stale in-memory sessions (existing logic)
    for (const [sessionId, session] of this.sessions) {
      const age = now - session.createdAt.getTime();
      if (age > maxAge && !['downloading', 'processing', 'transcoding', 'queued'].includes(session.status)) {
        await this.cleanup(sessionId);
      }
    }

    // Clean up expired cached files based on retention settings
    try {
      const deleted = await retentionService.cleanupExpiredFiles();
      if (deleted > 0) {
        logger.info(`Retention cleanup: removed ${deleted} expired file(s)`);
      }
    } catch (err) {
      logger.warn(`Retention cleanup failed: ${(err as Error).message}`);
    }
  }

  // Get queue info
  getQueueInfo(): { activeCount: number; queuedCount: number; maxConcurrent: number } {
    return {
      activeCount: this.activeDownloads.size,
      queuedCount: this.downloadQueue.filter(id => {
        const s = this.sessions.get(id);
        return s && s.status === 'queued';
      }).length,
      maxConcurrent: settingsService.get('maxConcurrentDownloads')
    };
  }

  // ============================================
  // Batch Operations
  // ============================================

  // Pause all queued downloads
  pauseAllQueued(): { paused: number } {
    let paused = 0;

    for (const sessionId of this.downloadQueue) {
      const session = this.sessions.get(sessionId);
      if (session && session.status === 'queued') {
        session.status = 'paused';
        session.pausedAt = new Date();
        this.emitProgress(session);
        paused++;
      }
    }

    this.updateQueuePositions();
    logger.info(`Batch pause: ${paused} downloads paused`);
    return { paused };
  }

  // Resume all paused downloads
  resumeAllPaused(): { resumed: number } {
    let resumed = 0;

    for (const sessionId of this.downloadQueue) {
      const session = this.sessions.get(sessionId);
      if (session && session.status === 'paused') {
        session.status = 'queued';
        session.pausedAt = undefined;
        this.emitProgress(session);
        resumed++;
      }
    }

    this.updateQueuePositions();
    this.processQueue();
    logger.info(`Batch resume: ${resumed} downloads resumed`);
    return { resumed };
  }

  // Clear all completed, failed, and cancelled downloads from the active list
  // NOTE: This only removes from the in-memory session list, it does NOT delete
  // the actual transcoded files. Those are managed separately in the cache.
  async clearCompleted(): Promise<{ cleared: number }> {
    let cleared = 0;
    const toRemove: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
        toRemove.push(sessionId);
      }
    }

    for (const sessionId of toRemove) {
      // Just remove from sessions map - don't call cleanup() which deletes files
      this.sessions.delete(sessionId);
      this.progressCallbacks.delete(sessionId);
      cleared++;
    }

    logger.info(`Batch clear: ${cleared} transcodes cleared from active list`);
    return { cleared };
  }
}

export const downloadService = new DownloadService();
