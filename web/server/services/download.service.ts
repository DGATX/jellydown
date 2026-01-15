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

type ProgressCallback = (progress: DownloadProgress) => void;

export class DownloadService {
  private sessions: Map<string, DownloadSession> = new Map();
  private progressCallbacks: Map<string, Set<ProgressCallback>> = new Map();

  // Queue management
  private activeDownloads: Set<string> = new Set();
  private downloadQueue: string[] = []; // Ordered session IDs

  constructor() {
    // Restore any resumable sessions on startup
    this.restoreResumableSessions().catch(err => {
      logger.warn(`Failed to restore sessions: ${err.message}`);
    });
  }

  // Start a new download (adds to queue)
  async startDownload(
    itemId: string,
    mediaSourceId: string,
    title: string,
    hlsUrl: string,
    expectedDurationSeconds: number,
    transcodeSettings: TranscodeSettings
  ): Promise<DownloadSession> {
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
      queuedAt: new Date()
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
        .catch(err => {
          logger.error(`Download failed for ${session.title}: ${err.message}`);
          session.status = 'failed';
          session.error = err.message;
          this.saveState(session).catch(() => {});
          this.emitProgress(session);
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
      this.updateSession(session.id, { status: 'downloading' });

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
        (completed, total) => {
          const progress = completed / total;
          this.updateSession(session.id, {
            progress,
            completedSegments: completed
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

      const finalPath = path.join(config.downloadsDir, session.id, session.filename);

      logger.info(`[${session.id}] Muxing with ffmpeg to: ${finalPath}`);

      await segmentService.concatenateWithFfmpeg(
        result.initSegmentPath,
        result.segmentPaths,
        finalPath
      );

      const stat = await fsp.stat(finalPath);
      const totalSize = stat.size;

      this.updateSession(session.id, {
        status: 'completed',
        progress: 1,
        totalSize,
        finalPath
      });

      logger.info(`[${session.id}] Download complete: ${Math.round(totalSize / 1024 / 1024)}MB`);

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

      const result = await segmentService.downloadSegments(
        session.segments,
        undefined,
        session.tempDir,
        (completed, total) => {
          const progress = completed / total;
          this.updateSession(session.id, {
            progress,
            completedSegments: completed
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

      const finalPath = path.join(config.downloadsDir, session.id, session.filename);

      logger.info(`[${session.id}] Muxing resumed download with ffmpeg to: ${finalPath}`);

      await segmentService.concatenateWithFfmpeg(
        initPath,
        result.segmentPaths,
        finalPath
      );

      const stat = await fsp.stat(finalPath);
      const totalSize = stat.size;

      this.updateSession(session.id, {
        status: 'completed',
        progress: 1,
        totalSize,
        finalPath
      });

      logger.info(`[${session.id}] Resume complete: ${Math.round(totalSize / 1024 / 1024)}MB`);

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
        segments: state.segments
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
        queuePosition: session.queuePosition
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
      queuePosition: session.queuePosition
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
      queuePosition: session.queuePosition
    };

    callbacks.forEach(cb => cb(progress));
  }

  // Cleanup stale sessions
  async cleanupStaleSessions(): Promise<void> {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const [sessionId, session] of this.sessions) {
      const age = now - session.createdAt.getTime();
      if (age > maxAge && !['downloading', 'processing', 'transcoding', 'queued'].includes(session.status)) {
        await this.cleanup(sessionId);
      }
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
}

export const downloadService = new DownloadService();
