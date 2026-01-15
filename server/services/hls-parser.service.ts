import axios from 'axios';
import { URL } from 'url';
import { HLSMasterPlaylist, HLSMediaPlaylist, HLSSegment } from '../models/types';
import { config } from '../config';
import { logger } from '../index';

export class HLSParserService {
  // Parse master playlist to get media playlist URL (port of HLSParser.swift parseMasterPlaylist)
  async parseMasterPlaylist(url: string): Promise<HLSMasterPlaylist> {
    // Log the URL being fetched (redact api_key for security)
    const sanitizedUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
    logger.info(`Fetching master playlist: ${sanitizedUrl}`);

    try {
      const response = await axios.get(url, { timeout: config.segmentTimeoutMs });
      const content = response.data as string;
      logger.info(`Master playlist fetched successfully, length: ${content.length}`);

      const lines = content.split('\n');
      let bandwidth: number | undefined;
      let resolution: string | undefined;
      let codecs: string | undefined;
      let mediaPlaylistPath: string | undefined;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          // Parse stream info attributes
          const attrs = this.parseAttributes(line);
          bandwidth = attrs['BANDWIDTH'] ? parseInt(attrs['BANDWIDTH'], 10) : undefined;
          resolution = attrs['RESOLUTION'];
          codecs = attrs['CODECS'];

          // Next non-empty, non-comment line is the playlist URL
          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j].trim();
            if (nextLine && !nextLine.startsWith('#')) {
              mediaPlaylistPath = nextLine;
              break;
            }
          }
          break;
        }
      }

      if (!mediaPlaylistPath) {
        throw new Error('No media playlist found in master playlist');
      }

      // Resolve relative URL
      const mediaPlaylistUrl = this.resolveUrl(url, mediaPlaylistPath);

      return {
        mediaPlaylistUrl,
        bandwidth,
        resolution,
        codecs
      };
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: unknown }; message?: string };
      logger.error(`Failed to fetch master playlist: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      throw err;
    }
  }

  // Parse media playlist to get segments (port of HLSParser.swift parseMediaPlaylist)
  async parseMediaPlaylist(url: string): Promise<HLSMediaPlaylist> {
    const sanitizedUrl = url.replace(/api_key=[^&]+/, 'api_key=***');
    logger.info(`Fetching media playlist: ${sanitizedUrl}`);

    try {
      const response = await axios.get(url, { timeout: config.segmentTimeoutMs });
      const content = response.data as string;
      logger.info(`Media playlist fetched successfully, length: ${content.length}`);
      return this.parseMediaPlaylistContent(content, url);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: unknown }; message?: string };
      logger.error(`Failed to fetch media playlist: ${error.message}`);
      if (error.response) {
        logger.error(`Response status: ${error.response.status}`);
        logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      throw err;
    }
  }

  // Parse media playlist content
  parseMediaPlaylistContent(content: string, baseUrl: string): HLSMediaPlaylist {
    const lines = content.split('\n');
    const segments: HLSSegment[] = [];
    let initSegmentUrl: string | undefined;
    let targetDuration = 6;
    let currentDuration = 0;
    let totalDuration = 0;
    let currentByteRange: { length: number; offset: number } | undefined;
    let segmentIndex = 0;
    const isComplete = content.includes('#EXT-X-ENDLIST');

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('#EXT-X-TARGETDURATION:')) {
        const value = trimmedLine.replace('#EXT-X-TARGETDURATION:', '');
        targetDuration = parseInt(value, 10) || 6;
      } else if (trimmedLine.startsWith('#EXT-X-MAP:')) {
        // Init segment for fMP4
        const attrs = this.parseAttributes(trimmedLine);
        const uri = attrs['URI'];
        if (uri) {
          const cleanUri = uri.replace(/^"|"$/g, '');
          initSegmentUrl = this.resolveUrl(baseUrl, cleanUri);
        }
      } else if (trimmedLine.startsWith('#EXTINF:')) {
        const durationStr = trimmedLine.replace('#EXTINF:', '').split(',')[0];
        currentDuration = parseFloat(durationStr) || 0;
      } else if (trimmedLine.startsWith('#EXT-X-BYTERANGE:')) {
        const rangeStr = trimmedLine.replace('#EXT-X-BYTERANGE:', '');
        currentByteRange = this.parseByteRange(rangeStr);
      } else if (trimmedLine && !trimmedLine.startsWith('#')) {
        // This is a segment URL
        const segmentUrl = this.resolveUrl(baseUrl, trimmedLine);

        segments.push({
          index: segmentIndex,
          url: segmentUrl,
          duration: currentDuration,
          byteRange: currentByteRange
        });

        totalDuration += currentDuration;
        segmentIndex++;
        currentDuration = 0;
        currentByteRange = undefined;
      }
    }

    return {
      segments,
      initSegmentUrl,
      targetDuration,
      totalDuration,
      isComplete
    };
  }

  // Parse attributes from HLS tag
  private parseAttributes(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return attrs;

    const attributeString = line.substring(colonIndex + 1);
    let current = '';
    let inQuotes = false;
    let key = '';

    for (const char of attributeString) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === '=' && !inQuotes) {
        key = current.trim();
        current = '';
      } else if (char === ',' && !inQuotes) {
        if (key) {
          attrs[key] = current.trim();
        }
        key = '';
        current = '';
      } else {
        current += char;
      }
    }

    // Don't forget the last pair
    if (key) {
      attrs[key] = current.trim();
    }

    return attrs;
  }

  // Parse byte range string
  private parseByteRange(rangeStr: string): { length: number; offset: number } | undefined {
    const parts = rangeStr.split('@');
    const length = parseInt(parts[0], 10);
    if (isNaN(length)) return undefined;

    const offset = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    return { length, offset: isNaN(offset) ? 0 : offset };
  }

  // Resolve relative URL against base URL
  private resolveUrl(base: string, relative: string): string {
    if (relative.startsWith('http://') || relative.startsWith('https://')) {
      return relative;
    }

    try {
      const baseUrl = new URL(base);
      // Remove the filename from base path to get directory
      const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);

      // Check if relative path has query params - handle them properly
      const [relativePath, relativeQuery] = relative.split('?');
      baseUrl.pathname = basePath + relativePath;

      // Merge query parameters
      if (relativeQuery) {
        const newParams = new URLSearchParams(relativeQuery);
        newParams.forEach((value, key) => {
          baseUrl.searchParams.set(key, value);
        });
      }

      const resolved = baseUrl.toString();
      logger.debug(`Resolved URL: ${base} + ${relative} => ${resolved.replace(/api_key=[^&]+/, 'api_key=***')}`);
      return resolved;
    } catch {
      // Fallback: simple concatenation
      const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
      return baseDir + relative;
    }
  }
}

export const hlsParser = new HLSParserService();
