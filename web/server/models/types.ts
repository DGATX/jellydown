// Session types
export interface SessionData {
  serverUrl: string;
  accessToken: string;
  userId: string;
  serverId: string;
  deviceId: string;
  username: string;
}

// Saved server configuration
export interface SavedServer {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  // Note: We don't store passwords - user must re-authenticate
  lastUsed?: Date;
}

// Jellyfin API types
export interface PublicServerInfo {
  ServerName: string;
  Version: string;
  Id: string;
  LocalAddress?: string;
}

export interface AuthResult {
  User: JellyfinUser;
  AccessToken: string;
  ServerId: string;
}

export interface JellyfinUser {
  Id: string;
  Name: string;
  HasPassword: boolean;
  PrimaryImageTag?: string;
}

export interface LibraryView {
  Id: string;
  Name: string;
  CollectionType?: string;
  Type: string;
  ImageTags?: Record<string, string>;
}

export interface LibraryViewsResult {
  Items: LibraryView[];
}

export interface MediaItem {
  Id: string;
  Name: string;
  Type: string;
  Overview?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  OfficialRating?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  MediaSources?: MediaSource[];
  MediaStreams?: MediaStream[];
  Container?: string;
}

export interface MediaSource {
  Id: string;
  Name?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  SupportsTranscoding: boolean;
  SupportsDirectStream: boolean;
  SupportsDirectPlay: boolean;
  MediaStreams?: MediaStream[];
  Path?: string;
}

export interface MediaStream {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage';
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  IsDefault: boolean;
  IsForced: boolean;
  BitRate?: number;
  Channels?: number;
  SampleRate?: number;
  Height?: number;
  Width?: number;
  IsTextSubtitleStream?: boolean;
  SupportsExternalStream?: boolean;
  Path?: string;
}

export interface ItemsResult {
  Items: MediaItem[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface ItemsQuery {
  parentId?: string;
  includeItemTypes?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: number;
  startIndex?: number;
  searchTerm?: string;
  fields?: string;
  recursive?: boolean;
}

// Transcode types
export interface TranscodeSettings {
  maxWidth: number;
  maxBitrate: number;
  videoCodec: string;
  audioCodec: string;
  audioBitrate: number;
  audioChannels: number;
}

// Custom preset with id and name for user-editable presets
export interface CustomPreset extends TranscodeSettings {
  id: string;
  name: string;
}

export const TRANSCODE_PRESETS: Record<string, TranscodeSettings> = {
  low: {
    maxWidth: 854,
    maxBitrate: 1_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 128_000,
    audioChannels: 2
  },
  medium: {
    maxWidth: 1280,
    maxBitrate: 2_500_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 192_000,
    audioChannels: 2
  },
  high: {
    maxWidth: 1920,
    maxBitrate: 5_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 256_000,
    audioChannels: 2
  },
  veryHigh: {
    maxWidth: 1920,
    maxBitrate: 8_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 320_000,
    audioChannels: 6
  }
};

// HLS types
export interface HLSMasterPlaylist {
  mediaPlaylistUrl: string;
  bandwidth?: number;
  resolution?: string;
  codecs?: string;
}

export interface HLSMediaPlaylist {
  segments: HLSSegment[];
  initSegmentUrl?: string;
  targetDuration: number;
  totalDuration: number;
  isComplete: boolean;
}

export interface HLSSegment {
  index: number;
  url: string;
  duration: number;
  byteRange?: {
    length: number;
    offset: number;
  };
}

// Download types
export type DownloadStatus =
  | 'queued'       // Waiting in queue
  | 'paused'       // User paused
  | 'transcoding'  // Jellyfin transcoding in progress
  | 'downloading'  // Downloading segments
  | 'processing'   // Muxing with ffmpeg
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DownloadSession {
  id: string;
  itemId: string;
  mediaSourceId: string;
  title: string;
  filename: string;
  status: DownloadStatus;
  progress: number;
  completedSegments: number;
  totalSegments: number;
  tempDir: string;
  segmentPaths: string[];
  initSegmentPath?: string;
  hlsUrl?: string;
  mediaPlaylistUrl?: string; // For resume
  totalSize?: number;
  error?: string;
  createdAt: Date;
  transcodeSettings: TranscodeSettings;
  expectedDurationSeconds: number;
  // Resume support
  completedSegmentIndexes: Set<number>;
  segments?: HLSSegment[]; // Cached segment list for resume
  // Path to final muxed MP4 file
  finalPath?: string;
  // Queue support
  queuePosition?: number;  // Position in queue (1-based, undefined if active)
  queuedAt?: Date;         // When added to queue
  pausedAt?: Date;         // When paused
  // Speed & ETA tracking
  bytesDownloaded: number; // Total bytes downloaded so far
  downloadStartedAt?: Date; // When downloading actually started
  // Soft subtitles (muxed after download instead of burned)
  softSubtitle?: {
    streamIndex: number;
    language?: string;
    codec?: string;
    jellyfinUrl: string;   // Base Jellyfin server URL
    accessToken: string;   // Jellyfin access token for fetching subtitle
  };
  // Retry support
  retryCount?: number;     // Number of times this download has been retried
  lastError?: string;      // Last error message before retry
}

export interface DownloadProgress {
  sessionId: string;
  title?: string;
  filename?: string;
  status: DownloadStatus;
  progress: number;
  completedSegments: number;
  totalSegments: number;
  error?: string;
  createdAt?: Date;
  // Resume support
  canResume?: boolean;
  // Queue support
  queuePosition?: number;
  // Speed & ETA tracking
  bytesDownloaded?: number;
  downloadStartedAt?: Date;
}

// App settings
export interface AppSettings {
  maxConcurrentDownloads: number;
  downloadsDir: string;
  presets: CustomPreset[];
  savedServers: SavedServer[];
  defaultRetentionDays: number | null;  // null = forever, 1-365 = days to keep
}

// File retention metadata stored per-download
export interface FileRetentionMeta {
  sessionId: string;
  retentionDays: number | null;  // null = use global default
  downloadedAt: string;          // ISO date string
  expiresAt: string | null;      // ISO date string, null = forever
}

// State file for resume capability
export interface DownloadState {
  sessionId: string;
  itemId: string;
  mediaSourceId: string;
  title: string;
  filename: string;
  hlsUrl: string;
  mediaPlaylistUrl?: string;
  status: DownloadStatus;
  totalSegments: number;
  completedSegmentIndexes: number[];
  segments: HLSSegment[];
  expectedDurationSeconds: number;
  transcodeSettings: TranscodeSettings;
  createdAt: string;
  updatedAt: string;
}

// Batch download types
export interface BatchDownloadItem {
  itemId: string;
  mediaSourceId?: string;
}

export interface BatchDownloadRequest {
  items: BatchDownloadItem[];
  preset: string;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

export interface BatchDownloadResult {
  itemId: string;
  sessionId?: string;
  filename?: string;
  success: boolean;
  error?: string;
}

export interface BatchCancelRequest {
  itemIds: string[];
}

export interface BatchCancelResult {
  cancelled: number;
  removed: number;
}

// Extend express-session
declare module 'express-session' {
  interface SessionData {
    jellyfin?: {
      serverUrl: string;
      accessToken: string;
      userId: string;
      serverId: string;
      deviceId: string;
      username: string;
    };
  }
}
