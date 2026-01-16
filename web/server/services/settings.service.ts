import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AppSettings, CustomPreset, SavedServer } from '../models/types';
import { config } from '../config';

// Default presets matching the original TRANSCODE_PRESETS
const DEFAULT_PRESETS: CustomPreset[] = [
  {
    id: 'low',
    name: 'Low (480p)',
    maxWidth: 854,
    maxBitrate: 1_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 128_000,
    audioChannels: 2
  },
  {
    id: 'medium',
    name: 'Medium (720p)',
    maxWidth: 1280,
    maxBitrate: 2_500_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 192_000,
    audioChannels: 2
  },
  {
    id: 'high',
    name: 'High (1080p)',
    maxWidth: 1920,
    maxBitrate: 5_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 256_000,
    audioChannels: 2
  },
  {
    id: 'veryHigh',
    name: 'Very High (1080p+)',
    maxWidth: 1920,
    maxBitrate: 8_000_000,
    videoCodec: 'h264',
    audioCodec: 'aac',
    audioBitrate: 320_000,
    audioChannels: 6
  }
];

const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentDownloads: 5,
  downloadsDir: config.downloadsDir,
  presets: DEFAULT_PRESETS,
  savedServers: [],
  defaultRetentionDays: null  // null = forever (keep until manually deleted)
};

export class SettingsService {
  private settingsPath: string;
  private settings: AppSettings;
  private loaded = false;

  constructor() {
    this.settingsPath = path.join(config.dataDir, 'settings.json');
    this.settings = { ...DEFAULT_SETTINGS };
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const data = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      this.settings = { ...DEFAULT_SETTINGS, ...parsed };
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error('Failed to load settings:', err);
      }
      // Use defaults if file doesn't exist or parse fails
      this.settings = { ...DEFAULT_SETTINGS };
    }

    this.loaded = true;
  }

  async save(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
      await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      console.error('Failed to save settings:', err);
      throw err;
    }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  async set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    this.settings[key] = value;
    await this.save();
  }

  getAll(): AppSettings {
    return { ...this.settings };
  }

  async update(updates: Partial<AppSettings>): Promise<void> {
    // Validate maxConcurrentDownloads
    if (updates.maxConcurrentDownloads !== undefined) {
      const val = updates.maxConcurrentDownloads;
      if (typeof val !== 'number' || val < 1 || val > 20) {
        throw new Error('maxConcurrentDownloads must be between 1 and 20');
      }
    }

    // Validate downloadsDir
    if (updates.downloadsDir !== undefined) {
      const dir = updates.downloadsDir;
      if (typeof dir !== 'string' || dir.trim().length === 0) {
        throw new Error('downloadsDir must be a non-empty string');
      }
      // Resolve the path and ensure it's absolute
      const resolvedPath = path.resolve(dir);
      try {
        // Try to create the directory if it doesn't exist
        await fs.mkdir(resolvedPath, { recursive: true });
        // Test write access by creating and removing a temp file
        const testFile = path.join(resolvedPath, '.write-test');
        await fs.writeFile(testFile, '');
        await fs.unlink(testFile);
      } catch (err) {
        throw new Error(`Cannot write to directory: ${resolvedPath}`);
      }
      // Store the resolved absolute path
      updates.downloadsDir = resolvedPath;
    }

    // Validate presets
    if (updates.presets !== undefined) {
      if (!Array.isArray(updates.presets) || updates.presets.length === 0) {
        throw new Error('At least one preset is required');
      }
      const ids = new Set<string>();
      for (const preset of updates.presets) {
        // Validate required fields
        if (!preset.id || typeof preset.id !== 'string') {
          throw new Error('Preset id is required and must be a string');
        }
        if (!preset.name || typeof preset.name !== 'string') {
          throw new Error('Preset name is required and must be a string');
        }
        // Check for duplicate ids
        if (ids.has(preset.id)) {
          throw new Error(`Duplicate preset id: ${preset.id}`);
        }
        ids.add(preset.id);
        // Validate numeric fields
        if (typeof preset.maxWidth !== 'number' || preset.maxWidth < 320 || preset.maxWidth > 7680) {
          throw new Error('maxWidth must be between 320 and 7680');
        }
        if (typeof preset.maxBitrate !== 'number' || preset.maxBitrate < 100_000 || preset.maxBitrate > 100_000_000) {
          throw new Error('maxBitrate must be between 100000 and 100000000');
        }
        if (typeof preset.audioBitrate !== 'number' || preset.audioBitrate < 32_000 || preset.audioBitrate > 640_000) {
          throw new Error('audioBitrate must be between 32000 and 640000');
        }
        if (typeof preset.audioChannels !== 'number' || ![2, 6].includes(preset.audioChannels)) {
          throw new Error('audioChannels must be 2 or 6');
        }
        // Validate and set video codec (default to h264 if not provided)
        const validVideoCodecs = ['h264', 'hevc'];
        if (preset.videoCodec && !validVideoCodecs.includes(preset.videoCodec)) {
          throw new Error('videoCodec must be h264 or hevc');
        }
        preset.videoCodec = preset.videoCodec || 'h264';
        preset.audioCodec = 'aac';
      }
    }

    // Validate defaultRetentionDays
    if (updates.defaultRetentionDays !== undefined) {
      const val = updates.defaultRetentionDays;
      if (val !== null && (typeof val !== 'number' || val < 1 || val > 365 || !Number.isInteger(val))) {
        throw new Error('defaultRetentionDays must be null (forever) or an integer between 1 and 365');
      }
    }

    this.settings = { ...this.settings, ...updates };
    await this.save();
  }

  // Server management methods
  getSavedServers(): SavedServer[] {
    return this.settings.savedServers || [];
  }

  async addServer(server: Omit<SavedServer, 'id'>): Promise<SavedServer> {
    const newServer: SavedServer = {
      ...server,
      id: `server_${uuidv4()}`
    };
    this.settings.savedServers = [...(this.settings.savedServers || []), newServer];
    await this.save();
    return newServer;
  }

  async removeServer(serverId: string): Promise<void> {
    this.settings.savedServers = (this.settings.savedServers || []).filter(s => s.id !== serverId);
    await this.save();
  }

  async updateServerLastUsed(serverId: string): Promise<void> {
    const server = this.settings.savedServers?.find(s => s.id === serverId);
    if (server) {
      server.lastUsed = new Date();
      await this.save();
    }
  }

  getServerById(serverId: string): SavedServer | undefined {
    return this.settings.savedServers?.find(s => s.id === serverId);
  }
}

export const settingsService = new SettingsService();
