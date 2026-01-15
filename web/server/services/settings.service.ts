import * as fs from 'fs/promises';
import * as path from 'path';
import { AppSettings } from '../models/types';
import { config } from '../config';

const DEFAULT_SETTINGS: AppSettings = {
  maxConcurrentDownloads: 5
};

class SettingsService {
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

    this.settings = { ...this.settings, ...updates };
    await this.save();
  }
}

export const settingsService = new SettingsService();
