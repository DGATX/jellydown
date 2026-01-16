import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import {
  PublicServerInfo,
  AuthResult,
  LibraryView,
  LibraryViewsResult,
  MediaItem,
  ItemsResult,
  ItemsQuery,
  TranscodeSettings
} from '../models/types';

export class JellyfinService {
  private client: AxiosInstance;
  private serverUrl: string;
  private accessToken?: string;
  private userId?: string;
  private deviceId: string;

  constructor(serverUrl: string, accessToken?: string, userId?: string, deviceId?: string) {
    // Normalize URL: remove trailing slash only, preserve http/https as entered by user
    const normalizedUrl = serverUrl.replace(/\/$/, '');
    this.serverUrl = normalizedUrl;
    this.accessToken = accessToken;
    this.userId = userId;
    this.deviceId = deviceId || uuidv4();

    this.client = axios.create({
      baseURL: this.serverUrl,
      timeout: config.segmentTimeoutMs, // Use config value for consistency
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // Build MediaBrowser auth header (from NetworkManager.swift lines 75-90)
  private buildAuthHeader(withToken: boolean = true): string {
    const parts = [
      `Client="${config.appName}"`,
      `Device="WebBrowser"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${config.appVersion}"`
    ];

    if (withToken && this.accessToken) {
      parts.push(`Token="${this.accessToken}"`);
    }

    return `MediaBrowser ${parts.join(', ')}`;
  }

  // Test connection to server
  async testConnection(): Promise<PublicServerInfo> {
    const response = await this.client.get<PublicServerInfo>('/System/Info/Public');
    return response.data;
  }

  // Authenticate with username/password
  async authenticate(username: string, password: string): Promise<AuthResult> {
    const authHeader = this.buildAuthHeader(false);
    const response = await this.client.post<AuthResult>(
      '/Users/AuthenticateByName',
      {
        Username: username,
        Pw: password
      },
      {
        headers: {
          // Use both header names - some reverse proxies strip 'Authorization'
          'Authorization': authHeader,
          'X-Emby-Authorization': authHeader
        }
      }
    );

    // Store credentials
    this.accessToken = response.data.AccessToken;
    this.userId = response.data.User.Id;

    return response.data;
  }

  // Get library views (Movies, TV Shows, etc.)
  async getLibraryViews(): Promise<LibraryView[]> {
    if (!this.userId) throw new Error('Not authenticated');

    const response = await this.client.get<LibraryViewsResult>(
      `/Users/${this.userId}/Views`,
      {
        headers: {
          'Authorization': this.buildAuthHeader(),
          'X-Emby-Authorization': this.buildAuthHeader()
        }
      }
    );

    return response.data.Items;
  }

  // Get items in a library
  async getItems(query: ItemsQuery = {}): Promise<ItemsResult> {
    if (!this.userId) throw new Error('Not authenticated');

    const params: Record<string, string> = {};

    if (query.parentId) params.ParentId = query.parentId;
    if (query.includeItemTypes) params.IncludeItemTypes = query.includeItemTypes;
    if (query.sortBy) params.SortBy = query.sortBy;
    if (query.sortOrder) params.SortOrder = query.sortOrder;
    if (query.limit !== undefined) params.Limit = String(query.limit);
    if (query.startIndex !== undefined) params.StartIndex = String(query.startIndex);
    if (query.searchTerm) params.SearchTerm = query.searchTerm;
    if (query.recursive !== undefined) params.Recursive = String(query.recursive);

    // Always include useful fields
    params.Fields = query.fields || 'Overview,MediaSources,MediaStreams,Path,RunTimeTicks,PremiereDate,ProductionYear,OfficialRating,CommunityRating';

    const response = await this.client.get<ItemsResult>(
      `/Users/${this.userId}/Items`,
      {
        params,
        headers: {
          'Authorization': this.buildAuthHeader(),
          'X-Emby-Authorization': this.buildAuthHeader()
        }
      }
    );

    return response.data;
  }

  // Get all episodes for a series (using Jellyfin's Shows API)
  async getSeriesEpisodes(seriesId: string): Promise<ItemsResult> {
    if (!this.userId) throw new Error('Not authenticated');

    const response = await this.client.get<ItemsResult>(
      `/Shows/${seriesId}/Episodes`,
      {
        params: {
          UserId: this.userId,
          Fields: 'Overview,MediaSources,MediaStreams,Path,RunTimeTicks,PremiereDate,ProductionYear',
          SortBy: 'SortName',
          SortOrder: 'Ascending'
        },
        headers: {
          'Authorization': this.buildAuthHeader(),
          'X-Emby-Authorization': this.buildAuthHeader()
        }
      }
    );

    return response.data;
  }

  // Get a single item's details
  async getItem(itemId: string): Promise<MediaItem> {
    if (!this.userId) throw new Error('Not authenticated');

    const response = await this.client.get<MediaItem>(
      `/Users/${this.userId}/Items/${itemId}`,
      {
        params: {
          Fields: 'Overview,MediaSources,MediaStreams,Path,RunTimeTicks,PremiereDate,ProductionYear,OfficialRating,CommunityRating,Chapters'
        },
        headers: {
          'Authorization': this.buildAuthHeader(),
          'X-Emby-Authorization': this.buildAuthHeader()
        }
      }
    );

    return response.data;
  }

  // Build HLS URL for transcoded download (from JellyfinEndpoints.swift lines 221-247)
  buildHLSUrl(
    itemId: string,
    mediaSourceId: string,
    settings: TranscodeSettings,
    audioStreamIndex: number = 0,
    subtitleStreamIndex?: number
  ): string {
    const params = new URLSearchParams({
      MediaSourceId: mediaSourceId,
      VideoCodec: settings.videoCodec,
      AudioCodec: settings.audioCodec,
      VideoBitrate: String(settings.maxBitrate),
      AudioBitrate: String(settings.audioBitrate),
      MaxWidth: String(settings.maxWidth),
      AudioStreamIndex: String(audioStreamIndex),
      TranscodingMaxAudioChannels: String(settings.audioChannels),
      SegmentContainer: 'mp4',
      BreakOnNonKeyFrames: 'true',
      RequireAvc: 'false',
      api_key: this.accessToken || ''
    });

    if (subtitleStreamIndex !== undefined) {
      params.set('SubtitleStreamIndex', String(subtitleStreamIndex));
      params.set('SubtitleMethod', 'Encode');
    }

    return `${this.serverUrl}/Videos/${itemId}/master.m3u8?${params.toString()}`;
  }

  // Get image URL
  getImageUrl(itemId: string, type: string = 'Primary', maxWidth?: number): string {
    let url = `${this.serverUrl}/Items/${itemId}/Images/${type}`;
    if (maxWidth) {
      url += `?maxWidth=${maxWidth}`;
    }
    return url;
  }

  // Get system information including hardware acceleration status
  async getSystemInfo(): Promise<{
    serverName: string;
    version: string;
    hardwareAccelerationEnabled: boolean;
    transcodingTempPath?: string;
    encoderLocationType?: string;
  }> {
    try {
      const authHeaders = {
        'Authorization': this.buildAuthHeader(),
        'X-Emby-Authorization': this.buildAuthHeader()
      };

      const response = await this.client.get('/System/Info', { headers: authHeaders });
      const info = response.data;

      // Try multiple endpoints to get encoding configuration
      // /System/Configuration/encoding is the dedicated encoding config endpoint
      // /System/Configuration contains EncodingOptions but requires admin
      let encodingConfig: any = null;
      let configSource = 'none';

      // Try the dedicated encoding endpoint first (Jellyfin 10.8+)
      try {
        const encodingResponse = await this.client.get('/System/Configuration/encoding', { headers: authHeaders });
        encodingConfig = encodingResponse.data;
        configSource = 'encoding endpoint';
        console.log('[Jellyfin] Got encoding config from /System/Configuration/encoding:', JSON.stringify(encodingConfig, null, 2));
      } catch (err: any) {
        console.log('[Jellyfin] /System/Configuration/encoding failed:', err.response?.status || err.message);
        // Fall back to full configuration endpoint
        try {
          const configResponse = await this.client.get('/System/Configuration', { headers: authHeaders });
          encodingConfig = configResponse.data?.EncodingOptions;
          configSource = 'full config';
          console.log('[Jellyfin] Got encoding config from /System/Configuration:', JSON.stringify(encodingConfig, null, 2));
        } catch (err2: any) {
          console.log('[Jellyfin] /System/Configuration failed:', err2.response?.status || err2.message);
          // User may not have admin access - that's ok
        }
      }

      // Check if hardware acceleration is enabled
      let hardwareAccelerationEnabled = false;
      let hwAccelType = 'software';

      if (encodingConfig) {
        // The field is HardwareAccelerationType in both endpoints
        const accelType = encodingConfig.HardwareAccelerationType || encodingConfig.hardwareAccelerationType;
        console.log('[Jellyfin] HardwareAccelerationType from', configSource, ':', accelType);
        if (accelType && accelType.toLowerCase() !== 'none' && accelType !== '') {
          hardwareAccelerationEnabled = true;
          hwAccelType = accelType;
        }
      } else {
        console.log('[Jellyfin] No encoding config available - user may not have admin access');
        hwAccelType = 'unknown (requires admin)';
      }

      return {
        serverName: info.ServerName || 'Jellyfin Server',
        version: info.Version || 'Unknown',
        hardwareAccelerationEnabled,
        transcodingTempPath: encodingConfig?.TranscodingTempPath || encodingConfig?.transcodingTempPath,
        encoderLocationType: hwAccelType
      };
    } catch (error: any) {
      console.error('[Jellyfin] getSystemInfo error:', error.message);
      // Return default values if we can't get system info
      return {
        serverName: 'Jellyfin Server',
        version: 'Unknown',
        hardwareAccelerationEnabled: false,
        encoderLocationType: 'error'
      };
    }
  }

  // Getters
  getServerUrl(): string {
    return this.serverUrl;
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  getDeviceId(): string {
    return this.deviceId;
  }
}

// Factory function for creating service from session
export function createJellyfinService(session: {
  serverUrl: string;
  accessToken: string;
  userId: string;
  deviceId: string;
}): JellyfinService {
  return new JellyfinService(
    session.serverUrl,
    session.accessToken,
    session.userId,
    session.deviceId
  );
}
