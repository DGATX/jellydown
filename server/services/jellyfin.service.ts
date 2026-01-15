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
