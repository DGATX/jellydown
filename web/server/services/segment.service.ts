import axios from 'axios';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Writable } from 'stream';
import { spawn } from 'child_process';
import { HLSSegment } from '../models/types';
import { config } from '../config';
import { logger } from '../index';

export interface SegmentPaths {
  initSegmentPath?: string;
  segmentPaths: string[];
  bytesDownloaded: number;
}

export class SegmentService {
  // Download a single segment with retry logic
  // Handles segments not yet transcoded by Jellyfin
  // Returns the number of bytes downloaded
  async downloadSegment(
    url: string,
    outputPath: string,
    retries: number = 8
  ): Promise<number> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 60000,
          headers: {
            'Connection': 'keep-alive'
          }
        });

        if (!response.data || response.data.length < 100) {
          throw new Error('Empty or too-small segment received');
        }

        // Verify we got video data, not a JSON error response
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('application/json') || contentType.includes('text/')) {
          // Try to parse as JSON to get error message
          try {
            const text = Buffer.from(response.data).toString('utf-8');
            const json = JSON.parse(text);
            throw new Error(`Server returned error: ${json.message || json.error || JSON.stringify(json).slice(0, 100)}`);
          } catch {
            throw new Error(`Server returned non-video response (${contentType})`);
          }
        }

        // Quick sanity check: fMP4 segments start with a box size + box type
        // First 4 bytes are size (big-endian), next 4 are type like 'ftyp', 'moof', 'styp'
        const data = Buffer.from(response.data);
        if (data.length >= 8) {
          const boxType = data.toString('ascii', 4, 8);
          const validBoxTypes = ['ftyp', 'styp', 'moof', 'mdat', 'sidx', 'free'];
          if (!validBoxTypes.some(t => boxType === t)) {
            // Check if it looks like JSON
            const preview = data.toString('utf-8', 0, Math.min(50, data.length));
            if (preview.trim().startsWith('{') || preview.trim().startsWith('[')) {
              throw new Error(`Server returned JSON instead of video segment`);
            }
          }
        }

        await fsp.writeFile(outputPath, response.data);
        return response.data.length; // Return bytes downloaded
      } catch (err) {
        lastError = err as Error;
        const errorMsg = (err as Error).message || '';

        if (attempt < retries - 1) {
          // Longer backoff to wait for transcode: 3s, 6s, 9s, 12s, 15s, 15s, 15s
          const delay = Math.min((attempt + 1) * 3000, 15000);
          logger.info(`Segment download attempt ${attempt + 1}/${retries} failed (${errorMsg.slice(0, 50)}), retry in ${delay}ms`);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Download failed after all retries');
  }

  // Download all segments with concurrency control (port of DownloadManager.swift parallel download)
  // Supports resume by skipping segments in completedIndexes set
  async downloadSegments(
    segments: HLSSegment[],
    initSegmentUrl: string | undefined,
    tempDir: string,
    onProgress?: (completed: number, total: number, bytesDownloaded: number) => void,
    onSegmentComplete?: (index: number) => void,
    completedIndexes?: Set<number>
  ): Promise<SegmentPaths> {
    // Ensure temp directory exists
    await fsp.mkdir(tempDir, { recursive: true });

    const result: SegmentPaths = {
      segmentPaths: [],
      bytesDownloaded: 0
    };

    const total = segments.length + (initSegmentUrl ? 1 : 0);
    let completed = completedIndexes ? completedIndexes.size : 0;
    let totalBytes = 0;

    // Download init segment first if present and not already downloaded
    if (initSegmentUrl) {
      const initPath = path.join(tempDir, 'init.mp4');
      const initExists = await this.fileExists(initPath);

      if (!initExists) {
        const bytes = await this.downloadSegment(initSegmentUrl, initPath);
        totalBytes += bytes;
        completed++;
        onProgress?.(completed, total, totalBytes);
      } else {
        // Already have init segment - get its size
        try {
          const stat = await fsp.stat(initPath);
          totalBytes += stat.size;
        } catch {}
        if (!completedIndexes?.size) {
          completed++; // Count init if not already counted
        }
      }
      result.initSegmentPath = initPath;
    }

    // Calculate bytes already downloaded from existing segments
    if (completedIndexes) {
      for (const index of completedIndexes) {
        const segPath = path.join(tempDir, `${index}.mp4`);
        try {
          const stat = await fsp.stat(segPath);
          totalBytes += stat.size;
        } catch {}
      }
    }

    // Filter out already completed segments
    const pendingSegments = completedIndexes
      ? segments.filter(s => !completedIndexes.has(s.index))
      : [...segments];

    console.log(`Downloading ${pendingSegments.length} segments (${segments.length - pendingSegments.length} already completed)`);

    // Download media segments with concurrency limit
    const segmentPaths: string[] = new Array(segments.length);

    // Pre-populate paths for completed segments
    if (completedIndexes) {
      for (const index of completedIndexes) {
        segmentPaths[index] = path.join(tempDir, `${index}.mp4`);
      }
    }

    const downloading: Promise<void>[] = [];

    const downloadNext = async (): Promise<void> => {
      while (pendingSegments.length > 0) {
        const segment = pendingSegments.shift();
        if (!segment) break;

        const segmentPath = path.join(tempDir, `${segment.index}.mp4`);

        try {
          const bytes = await this.downloadSegment(segment.url, segmentPath);
          segmentPaths[segment.index] = segmentPath;
          totalBytes += bytes;
          completed++;
          onProgress?.(completed, total, totalBytes);
          onSegmentComplete?.(segment.index);
        } catch (err) {
          throw new Error(`Failed to download segment ${segment.index}: ${(err as Error).message}`);
        }
      }
    };

    // Start concurrent downloads
    for (let i = 0; i < config.maxConcurrentSegments; i++) {
      downloading.push(downloadNext());
    }

    await Promise.all(downloading);

    result.segmentPaths = segmentPaths.filter(p => p); // Remove any undefined
    result.bytesDownloaded = totalBytes;

    return result;
  }

  // Check if a file exists
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fsp.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Concatenate segments and stream to response (port of SegmentConcatenator.swift)
  async concatenateAndStream(
    initSegmentPath: string | undefined,
    segmentPaths: string[],
    outputStream: Writable
  ): Promise<void> {
    const BUFFER_SIZE = 1024 * 1024; // 1MB buffer

    // Stream init segment first
    if (initSegmentPath) {
      await this.streamFile(initSegmentPath, outputStream, BUFFER_SIZE);
    }

    // Stream each media segment in order
    for (const segmentPath of segmentPaths) {
      await this.streamFile(segmentPath, outputStream, BUFFER_SIZE);
    }
  }

  // Stream a file to output with chunked reading
  private async streamFile(
    filePath: string,
    outputStream: Writable,
    bufferSize: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath, { highWaterMark: bufferSize });

      readStream.on('data', (chunk) => {
        const canContinue = outputStream.write(chunk);
        if (!canContinue) {
          readStream.pause();
          outputStream.once('drain', () => readStream.resume());
        }
      });

      readStream.on('end', resolve);
      readStream.on('error', reject);
    });
  }

  // Calculate total size of segments
  async calculateTotalSize(
    initSegmentPath: string | undefined,
    segmentPaths: string[]
  ): Promise<number> {
    let total = 0;

    if (initSegmentPath) {
      const stat = await fsp.stat(initSegmentPath);
      total += stat.size;
    }

    for (const segmentPath of segmentPaths) {
      const stat = await fsp.stat(segmentPath);
      total += stat.size;
    }

    return total;
  }

  // Concatenate fMP4 segments and remux to MP4 with faststart
  // Uses binary concatenation (fMP4 segments can be directly concatenated)
  // then ffmpeg to add faststart for web streaming
  async concatenateWithFfmpeg(
    initSegmentPath: string | undefined,
    segmentPaths: string[],
    outputPath: string
  ): Promise<void> {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });

    const tempDir = path.dirname(segmentPaths[0]);
    const concatPath = path.join(tempDir, 'concat.mp4');

    logger.info(`Concatenating ${segmentPaths.length} segments to temp file`);

    // Binary concatenate all segments (fMP4 segments can be directly concatenated)
    const writeStream = fs.createWriteStream(concatPath);

    try {
      // Write init segment first
      if (initSegmentPath) {
        await this.pipeFile(initSegmentPath, writeStream);
      }

      // Write all media segments in order
      for (const segPath of segmentPaths) {
        await this.pipeFile(segPath, writeStream);
      }

      // Close the write stream
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.info(`Binary concatenation complete, remuxing with ffmpeg for faststart`);

      // Remux with ffmpeg to add faststart moov atom
      await this.remuxWithFaststart(concatPath, outputPath);

    } finally {
      // Clean up temp concat file
      try {
        await fsp.unlink(concatPath);
      } catch {
        // Ignore
      }
    }
  }

  // Pipe a file to a write stream
  private pipeFile(filePath: string, writeStream: fs.WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(filePath);
      readStream.on('error', reject);
      readStream.on('end', resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }

  // Remux with ffmpeg to add faststart
  private remuxWithFaststart(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      logger.info(`Running ffmpeg remux: ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info(`ffmpeg completed successfully: ${outputPath}`);
          resolve();
        } else {
          logger.error(`ffmpeg failed with code ${code}: ${stderr.slice(-500)}`);
          reject(new Error(`ffmpeg failed with code ${code}. Is ffmpeg installed?`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg not found. Please install ffmpeg: ${err.message}`));
      });
    });
  }

  // Fetch subtitle file from Jellyfin and save to disk
  async fetchSubtitle(
    jellyfinUrl: string,
    accessToken: string,
    itemId: string,
    mediaSourceId: string,
    subtitleIndex: number,
    outputDir: string
  ): Promise<string | null> {
    // Try different subtitle formats in order of preference
    const formats = ['srt', 'vtt', 'ass', 'sub'];

    for (const format of formats) {
      const url = `${jellyfinUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${subtitleIndex}/Stream.${format}?api_key=${accessToken}`;

      try {
        logger.info(`Fetching subtitle format: ${format}`);
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
          validateStatus: (status) => status < 500
        });

        if (response.status === 200 && response.data.length > 0) {
          const subtitlePath = path.join(outputDir, `subtitle.${format}`);
          await fsp.writeFile(subtitlePath, response.data);
          logger.info(`Subtitle downloaded successfully: ${subtitlePath} (${response.data.length} bytes)`);
          return subtitlePath;
        }
      } catch (err: any) {
        logger.debug(`Failed to fetch ${format} subtitle: ${err.message}`);
      }
    }

    logger.warn('Failed to fetch subtitle in any supported format');
    return null;
  }

  // Mux subtitle into MP4 using ffmpeg
  async muxWithSubtitle(
    videoPath: string,
    subtitlePath: string,
    outputPath: string,
    language?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Determine subtitle codec based on file extension
      const ext = path.extname(subtitlePath).toLowerCase().slice(1);
      const subtitleCodec = ext === 'ass' ? 'ass' : 'mov_text';

      const args = [
        '-i', videoPath,
        '-i', subtitlePath,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-c:s', subtitleCodec,
        '-map', '0:v',
        '-map', '0:a',
        '-map', '1:0',
        '-movflags', '+faststart'
      ];

      // Add language metadata if available
      if (language) {
        args.push('-metadata:s:s:0', `language=${language}`);
      }

      args.push('-y', outputPath);

      logger.info(`Running ffmpeg subtitle mux: ffmpeg ${args.join(' ')}`);

      const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info(`Subtitle muxed successfully: ${outputPath}`);
          resolve();
        } else {
          logger.error(`ffmpeg subtitle mux failed with code ${code}: ${stderr.slice(-500)}`);
          reject(new Error(`ffmpeg subtitle mux failed with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        reject(new Error(`ffmpeg not found: ${err.message}`));
      });
    });
  }

  // Cleanup temp directory
  async cleanup(tempDir: string): Promise<void> {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const segmentService = new SegmentService();
