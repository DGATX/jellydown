import * as fsp from 'fs/promises';
import * as path from 'path';
import { FileRetentionMeta } from '../models/types';
import { settingsService } from './settings.service';
import { logger } from '../index';

export class RetentionService {
  // Get metadata file path for a download session
  private getMetadataPath(downloadsDir: string, sessionId: string): string {
    return path.join(downloadsDir, sessionId, 'retention.json');
  }

  // Create retention metadata when download completes
  async createRetentionMeta(sessionId: string): Promise<FileRetentionMeta> {
    const downloadsDir = settingsService.get('downloadsDir');
    const defaultRetention = settingsService.get('defaultRetentionDays');
    const now = new Date();

    const meta: FileRetentionMeta = {
      sessionId,
      retentionDays: null,  // null = use global default
      downloadedAt: now.toISOString(),
      expiresAt: this.calculateExpiresAt(now, defaultRetention)
    };

    const metaPath = this.getMetadataPath(downloadsDir, sessionId);
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  // Read retention metadata for a download
  async getRetentionMeta(sessionId: string): Promise<FileRetentionMeta | null> {
    const downloadsDir = settingsService.get('downloadsDir');
    const metaPath = this.getMetadataPath(downloadsDir, sessionId);

    try {
      const content = await fsp.readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // Update retention for a specific file (per-file override)
  async updateRetention(sessionId: string, retentionDays: number | null): Promise<FileRetentionMeta> {
    const downloadsDir = settingsService.get('downloadsDir');
    let meta = await this.getRetentionMeta(sessionId);

    if (!meta) {
      // Create metadata if it doesn't exist (for legacy downloads)
      // Try to get download date from the first mp4 file in the directory
      let downloadedAt = new Date().toISOString();
      try {
        const dirPath = path.join(downloadsDir, sessionId);
        const files = await fsp.readdir(dirPath);
        const mp4File = files.find(f => f.endsWith('.mp4'));
        if (mp4File) {
          const stat = await fsp.stat(path.join(dirPath, mp4File));
          downloadedAt = stat.mtime.toISOString();
        }
      } catch {
        // Use current date if we can't determine the download date
      }

      meta = {
        sessionId,
        retentionDays: null,
        downloadedAt,
        expiresAt: null
      };
    }

    meta.retentionDays = retentionDays;

    // Calculate effective retention
    const effectiveRetention = retentionDays !== null
      ? retentionDays
      : settingsService.get('defaultRetentionDays');

    meta.expiresAt = this.calculateExpiresAt(new Date(meta.downloadedAt), effectiveRetention);

    const metaPath = this.getMetadataPath(downloadsDir, sessionId);
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }

  // Calculate expiration date
  private calculateExpiresAt(downloadedAt: Date, retentionDays: number | null): string | null {
    if (retentionDays === null || retentionDays === 0) {
      return null;  // Forever
    }
    const expiresAt = new Date(downloadedAt);
    expiresAt.setDate(expiresAt.getDate() + retentionDays);
    return expiresAt.toISOString();
  }

  // Get effective retention for a file (resolves global default if needed)
  async getEffectiveRetention(sessionId: string): Promise<{
    retentionDays: number | null;
    effectiveDays: number | null;
    expiresAt: Date | null;
    isOverride: boolean;
    downloadedAt: Date;
  }> {
    const downloadsDir = settingsService.get('downloadsDir');
    const defaultRetention = settingsService.get('defaultRetentionDays');
    let meta = await this.getRetentionMeta(sessionId);

    if (!meta) {
      // Legacy file without metadata - use file creation time
      let downloadedAt = new Date();
      try {
        const dirPath = path.join(downloadsDir, sessionId);
        const files = await fsp.readdir(dirPath);
        const mp4File = files.find(f => f.endsWith('.mp4'));
        if (mp4File) {
          const stat = await fsp.stat(path.join(dirPath, mp4File));
          downloadedAt = stat.mtime;
        }
      } catch {
        // Use current date if we can't determine
      }

      const expiresAt = defaultRetention !== null
        ? new Date(downloadedAt.getTime() + defaultRetention * 24 * 60 * 60 * 1000)
        : null;

      return {
        retentionDays: null,
        effectiveDays: defaultRetention,
        expiresAt,
        isOverride: false,
        downloadedAt
      };
    }

    const effectiveDays = meta.retentionDays !== null
      ? meta.retentionDays
      : defaultRetention;

    const downloadedAt = new Date(meta.downloadedAt);
    const expiresAt = effectiveDays !== null
      ? new Date(downloadedAt.getTime() + effectiveDays * 24 * 60 * 60 * 1000)
      : null;

    return {
      retentionDays: meta.retentionDays,
      effectiveDays,
      expiresAt,
      isOverride: meta.retentionDays !== null,
      downloadedAt
    };
  }

  // Get all files that should be cleaned up
  async getExpiredFiles(): Promise<string[]> {
    const downloadsDir = settingsService.get('downloadsDir');
    const defaultRetention = settingsService.get('defaultRetentionDays');
    const now = new Date();
    const expiredIds: string[] = [];

    try {
      const dirs = await fsp.readdir(downloadsDir);

      for (const dir of dirs) {
        const dirPath = path.join(downloadsDir, dir);
        try {
          const stat = await fsp.stat(dirPath);
          if (!stat.isDirectory()) continue;

          // Check for retention metadata
          const meta = await this.getRetentionMeta(dir);

          if (!meta) {
            // Legacy file without metadata - use file creation time and global default
            if (defaultRetention === null) continue;  // Forever by default

            const files = await fsp.readdir(dirPath);
            const mp4File = files.find(f => f.endsWith('.mp4'));
            if (!mp4File) continue;

            const fileStat = await fsp.stat(path.join(dirPath, mp4File));
            const downloadedAt = fileStat.mtime;
            const expiresAt = new Date(downloadedAt);
            expiresAt.setDate(expiresAt.getDate() + defaultRetention);

            if (now > expiresAt) {
              expiredIds.push(dir);
            }
          } else {
            // Has metadata - use effective retention
            const effectiveRetention = meta.retentionDays !== null
              ? meta.retentionDays
              : defaultRetention;

            if (effectiveRetention === null) continue;  // Forever

            const downloadedAt = new Date(meta.downloadedAt);
            const expiresAt = new Date(downloadedAt);
            expiresAt.setDate(expiresAt.getDate() + effectiveRetention);

            if (now > expiresAt) {
              expiredIds.push(dir);
            }
          }
        } catch {
          // Skip directories we can't read
          continue;
        }
      }
    } catch (err) {
      logger.warn(`Failed to scan for expired files: ${(err as Error).message}`);
    }

    return expiredIds;
  }

  // Clean up expired files
  async cleanupExpiredFiles(): Promise<number> {
    const downloadsDir = settingsService.get('downloadsDir');
    const expiredIds = await this.getExpiredFiles();
    let deleted = 0;

    for (const id of expiredIds) {
      try {
        await fsp.rm(path.join(downloadsDir, id), { recursive: true, force: true });
        logger.info(`Retention cleanup: deleted expired download ${id}`);
        deleted++;
      } catch (err) {
        logger.warn(`Failed to delete expired download ${id}: ${(err as Error).message}`);
      }
    }

    return deleted;
  }
}

export const retentionService = new RetentionService();
