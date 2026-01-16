import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { AppSettings, CustomPreset, SavedServer } from '../../models/types';

// Use a fixed path that we create on demand
const TEST_BASE_DIR = path.join(os.tmpdir(), 'jellyfin-settings-tests');

// Mock the config module with a getter for dynamic path
vi.mock('../../config', () => {
  const basePath = require('path').join(require('os').tmpdir(), 'jellyfin-settings-tests');
  return {
    config: {
      dataDir: basePath,
      downloadsDir: require('path').join(basePath, 'downloads'),
    },
  };
});

// Import after mocks are set up
import { SettingsService } from '../../services/settings.service';

// The actual path used in tests (must match the mock)
const TEST_DATA_DIR = TEST_BASE_DIR;

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(async () => {
    // Reset module registry to get fresh imports
    vi.resetModules();

    // Clean up any existing test data to ensure isolated tests
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    // Create fresh test directories
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
    await fs.mkdir(path.join(TEST_DATA_DIR, 'downloads'), { recursive: true });

    // Create a new instance for each test
    service = new SettingsService();
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('load', () => {
    it('should load default settings when no file exists', async () => {
      await service.load();

      const settings = service.getAll();
      expect(settings.maxConcurrentDownloads).toBe(5);
      expect(settings.presets).toHaveLength(4);
      expect(settings.savedServers).toEqual([]);
    });

    it('should load settings from file when it exists', async () => {
      const customSettings: Partial<AppSettings> = {
        maxConcurrentDownloads: 10,
        savedServers: [
          { id: 'server1', name: 'Test Server', serverUrl: 'http://test.local', username: 'user' }
        ]
      };

      await fs.writeFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        JSON.stringify(customSettings)
      );

      await service.load();

      const settings = service.getAll();
      expect(settings.maxConcurrentDownloads).toBe(10);
      expect(settings.savedServers).toHaveLength(1);
      expect(settings.savedServers[0].name).toBe('Test Server');
    });

    it('should merge with defaults for missing fields', async () => {
      const partialSettings = {
        maxConcurrentDownloads: 8
      };

      await fs.writeFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        JSON.stringify(partialSettings)
      );

      await service.load();

      const settings = service.getAll();
      expect(settings.maxConcurrentDownloads).toBe(8);
      expect(settings.presets).toHaveLength(4); // defaults
    });

    it('should handle corrupted JSON gracefully', async () => {
      await fs.writeFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        '{ invalid json }'
      );

      await service.load();

      // Should fall back to defaults
      const settings = service.getAll();
      expect(settings.maxConcurrentDownloads).toBe(5);
    });

    it('should only load once', async () => {
      await service.load();

      // Write new file
      await fs.writeFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        JSON.stringify({ maxConcurrentDownloads: 20 })
      );

      await service.load(); // Should not reload

      expect(service.get('maxConcurrentDownloads')).toBe(5);
    });
  });

  describe('save', () => {
    it('should persist settings to file', async () => {
      await service.load();
      await service.set('maxConcurrentDownloads', 15);

      // Read back from file
      const fileContent = await fs.readFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        'utf-8'
      );
      const saved = JSON.parse(fileContent);

      expect(saved.maxConcurrentDownloads).toBe(15);
    });

    it('should create data directory if it does not exist', async () => {
      // Remove the directory
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });

      // Create a new service instance (constructor doesn't create the dir)
      service = new SettingsService();
      await service.load();
      await service.set('maxConcurrentDownloads', 12);

      // Directory should be recreated
      const fileContent = await fs.readFile(
        path.join(TEST_DATA_DIR, 'settings.json'),
        'utf-8'
      );
      expect(JSON.parse(fileContent).maxConcurrentDownloads).toBe(12);
    });
  });

  describe('get/set', () => {
    beforeEach(async () => {
      await service.load();
    });

    it('should get specific setting', () => {
      expect(service.get('maxConcurrentDownloads')).toBe(5);
    });

    it('should set specific setting and persist', async () => {
      await service.set('maxConcurrentDownloads', 8);
      expect(service.get('maxConcurrentDownloads')).toBe(8);
    });
  });

  describe('getAll', () => {
    it('should return a copy of settings', async () => {
      await service.load();

      const settings1 = service.getAll();
      const settings2 = service.getAll();

      expect(settings1).not.toBe(settings2); // Different objects
      expect(settings1).toEqual(settings2); // Same content
    });
  });

  describe('update', () => {
    beforeEach(async () => {
      await service.load();
    });

    describe('maxConcurrentDownloads validation', () => {
      it('should accept valid concurrent downloads (1-20)', async () => {
        await service.update({ maxConcurrentDownloads: 1 });
        expect(service.get('maxConcurrentDownloads')).toBe(1);

        await service.update({ maxConcurrentDownloads: 20 });
        expect(service.get('maxConcurrentDownloads')).toBe(20);

        await service.update({ maxConcurrentDownloads: 10 });
        expect(service.get('maxConcurrentDownloads')).toBe(10);
      });

      it('should reject concurrent downloads < 1', async () => {
        await expect(
          service.update({ maxConcurrentDownloads: 0 })
        ).rejects.toThrow('maxConcurrentDownloads must be between 1 and 20');
      });

      it('should reject concurrent downloads > 20', async () => {
        await expect(
          service.update({ maxConcurrentDownloads: 21 })
        ).rejects.toThrow('maxConcurrentDownloads must be between 1 and 20');
      });

      it('should reject non-number concurrent downloads', async () => {
        await expect(
          service.update({ maxConcurrentDownloads: 'five' as any })
        ).rejects.toThrow('maxConcurrentDownloads must be between 1 and 20');
      });

      it('should reject negative concurrent downloads', async () => {
        await expect(
          service.update({ maxConcurrentDownloads: -5 })
        ).rejects.toThrow('maxConcurrentDownloads must be between 1 and 20');
      });
    });

    describe('downloadsDir validation', () => {
      it('should accept valid writable directory', async () => {
        const newDir = path.join(TEST_DATA_DIR, 'new-downloads');
        await fs.mkdir(newDir, { recursive: true });

        await service.update({ downloadsDir: newDir });
        expect(service.get('downloadsDir')).toBe(newDir);
      });

      it('should create directory if it does not exist', async () => {
        const newDir = path.join(TEST_DATA_DIR, 'auto-created-dir');

        await service.update({ downloadsDir: newDir });

        const stat = await fs.stat(newDir);
        expect(stat.isDirectory()).toBe(true);
      });

      it('should reject empty string', async () => {
        await expect(
          service.update({ downloadsDir: '' })
        ).rejects.toThrow('downloadsDir must be a non-empty string');
      });

      it('should reject whitespace-only string', async () => {
        await expect(
          service.update({ downloadsDir: '   ' })
        ).rejects.toThrow('downloadsDir must be a non-empty string');
      });

      it('should convert relative path to absolute', async () => {
        const relativePath = './test-downloads-' + Date.now();
        const absolutePath = path.resolve(relativePath);

        try {
          await service.update({ downloadsDir: relativePath });
          expect(path.isAbsolute(service.get('downloadsDir'))).toBe(true);
        } finally {
          // Cleanup
          await fs.rm(absolutePath, { recursive: true, force: true }).catch(() => {});
        }
      });
    });

    describe('presets validation', () => {
      const validPreset: CustomPreset = {
        id: 'custom',
        name: 'Custom Preset',
        maxWidth: 1920,
        maxBitrate: 5_000_000,
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioBitrate: 192_000,
        audioChannels: 2
      };

      it('should accept valid presets array', async () => {
        await service.update({ presets: [validPreset] });
        expect(service.get('presets')).toHaveLength(1);
      });

      it('should reject empty presets array', async () => {
        await expect(
          service.update({ presets: [] })
        ).rejects.toThrow('At least one preset is required');
      });

      it('should reject preset without id', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, id: '' }] })
        ).rejects.toThrow('Preset id is required and must be a string');
      });

      it('should reject preset without name', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, name: '' }] })
        ).rejects.toThrow('Preset name is required and must be a string');
      });

      it('should reject duplicate preset ids', async () => {
        await expect(
          service.update({
            presets: [
              validPreset,
              { ...validPreset } // Same id
            ]
          })
        ).rejects.toThrow('Duplicate preset id: custom');
      });

      it('should reject invalid maxWidth (too low)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, maxWidth: 100 }] })
        ).rejects.toThrow('maxWidth must be between 320 and 7680');
      });

      it('should reject invalid maxWidth (too high)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, maxWidth: 10000 }] })
        ).rejects.toThrow('maxWidth must be between 320 and 7680');
      });

      it('should reject invalid maxBitrate (too low)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, maxBitrate: 50_000 }] })
        ).rejects.toThrow('maxBitrate must be between 100000 and 100000000');
      });

      it('should reject invalid maxBitrate (too high)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, maxBitrate: 200_000_000 }] })
        ).rejects.toThrow('maxBitrate must be between 100000 and 100000000');
      });

      it('should reject invalid audioBitrate (too low)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, audioBitrate: 10_000 }] })
        ).rejects.toThrow('audioBitrate must be between 32000 and 640000');
      });

      it('should reject invalid audioBitrate (too high)', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, audioBitrate: 1_000_000 }] })
        ).rejects.toThrow('audioBitrate must be between 32000 and 640000');
      });

      it('should reject invalid audioChannels', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, audioChannels: 8 }] })
        ).rejects.toThrow('audioChannels must be 2 or 6');
      });

      it('should accept valid audioChannels (2)', async () => {
        await service.update({ presets: [{ ...validPreset, audioChannels: 2 }] });
        expect(service.get('presets')[0].audioChannels).toBe(2);
      });

      it('should accept valid audioChannels (6)', async () => {
        await service.update({ presets: [{ ...validPreset, audioChannels: 6 }] });
        expect(service.get('presets')[0].audioChannels).toBe(6);
      });

      it('should accept h264 video codec', async () => {
        await service.update({ presets: [{ ...validPreset, videoCodec: 'h264' }] });
        expect(service.get('presets')[0].videoCodec).toBe('h264');
      });

      it('should accept hevc video codec', async () => {
        await service.update({ presets: [{ ...validPreset, videoCodec: 'hevc' }] });
        expect(service.get('presets')[0].videoCodec).toBe('hevc');
      });

      it('should reject invalid video codec', async () => {
        await expect(
          service.update({ presets: [{ ...validPreset, videoCodec: 'vp9' }] })
        ).rejects.toThrow('videoCodec must be h264 or hevc');
      });

      it('should default videoCodec to h264 if not provided', async () => {
        const presetWithoutCodec = { ...validPreset };
        delete (presetWithoutCodec as any).videoCodec;

        await service.update({ presets: [presetWithoutCodec] });
        expect(service.get('presets')[0].videoCodec).toBe('h264');
      });

      it('should always set audioCodec to aac', async () => {
        await service.update({ presets: [{ ...validPreset, audioCodec: 'mp3' as any }] });
        expect(service.get('presets')[0].audioCodec).toBe('aac');
      });
    });
  });

  describe('server management', () => {
    beforeEach(async () => {
      await service.load();
    });

    describe('getSavedServers', () => {
      it('should return empty array initially', () => {
        expect(service.getSavedServers()).toEqual([]);
      });

      it('should return saved servers', async () => {
        await service.addServer({
          name: 'Server 1',
          serverUrl: 'http://server1.local',
          username: 'user1'
        });

        const servers = service.getSavedServers();
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe('Server 1');
      });
    });

    describe('addServer', () => {
      it('should add server with generated id', async () => {
        const server = await service.addServer({
          name: 'Test Server',
          serverUrl: 'http://test.local',
          username: 'testuser'
        });

        expect(server.id).toMatch(/^server_[0-9a-f-]{36}$/);
        expect(server.name).toBe('Test Server');
        expect(server.serverUrl).toBe('http://test.local');
        expect(server.username).toBe('testuser');
      });

      it('should persist added server', async () => {
        await service.addServer({
          name: 'Persistent Server',
          serverUrl: 'http://persistent.local',
          username: 'user'
        });

        // Read from file
        const fileContent = await fs.readFile(
          path.join(TEST_DATA_DIR, 'settings.json'),
          'utf-8'
        );
        const saved = JSON.parse(fileContent);

        expect(saved.savedServers).toHaveLength(1);
        expect(saved.savedServers[0].name).toBe('Persistent Server');
      });

      it('should add multiple servers', async () => {
        await service.addServer({
          name: 'Server 1',
          serverUrl: 'http://server1.local',
          username: 'user1'
        });

        await service.addServer({
          name: 'Server 2',
          serverUrl: 'http://server2.local',
          username: 'user2'
        });

        expect(service.getSavedServers()).toHaveLength(2);
      });
    });

    describe('removeServer', () => {
      it('should remove server by id', async () => {
        const server = await service.addServer({
          name: 'To Remove',
          serverUrl: 'http://remove.local',
          username: 'user'
        });

        await service.removeServer(server.id);

        expect(service.getSavedServers()).toHaveLength(0);
      });

      it('should not affect other servers', async () => {
        const server1 = await service.addServer({
          name: 'Server 1',
          serverUrl: 'http://server1.local',
          username: 'user1'
        });

        await service.addServer({
          name: 'Server 2',
          serverUrl: 'http://server2.local',
          username: 'user2'
        });

        await service.removeServer(server1.id);

        const servers = service.getSavedServers();
        expect(servers).toHaveLength(1);
        expect(servers[0].name).toBe('Server 2');
      });

      it('should handle removing non-existent server gracefully', async () => {
        await service.removeServer('non-existent-id');
        // Should not throw
        expect(service.getSavedServers()).toHaveLength(0);
      });
    });

    describe('updateServerLastUsed', () => {
      it('should update lastUsed timestamp', async () => {
        const server = await service.addServer({
          name: 'Server',
          serverUrl: 'http://server.local',
          username: 'user'
        });

        const beforeUpdate = service.getServerById(server.id)?.lastUsed;

        await service.updateServerLastUsed(server.id);

        const afterUpdate = service.getServerById(server.id)?.lastUsed;
        expect(afterUpdate).toBeDefined();
        expect(afterUpdate).not.toBe(beforeUpdate);
      });

      it('should handle non-existent server gracefully', async () => {
        await service.updateServerLastUsed('non-existent');
        // Should not throw
      });
    });

    describe('getServerById', () => {
      it('should return server by id', async () => {
        const added = await service.addServer({
          name: 'Find Me',
          serverUrl: 'http://findme.local',
          username: 'user'
        });

        const found = service.getServerById(added.id);
        expect(found?.name).toBe('Find Me');
      });

      it('should return undefined for non-existent id', () => {
        const found = service.getServerById('non-existent');
        expect(found).toBeUndefined();
      });
    });
  });

  describe('default presets', () => {
    beforeEach(async () => {
      await service.load();
    });

    it('should have 4 default presets', () => {
      const presets = service.get('presets');
      expect(presets).toHaveLength(4);
    });

    it('should have low preset', () => {
      const presets = service.get('presets');
      const low = presets.find(p => p.id === 'low');
      expect(low).toBeDefined();
      expect(low?.maxWidth).toBe(854);
      expect(low?.maxBitrate).toBe(1_000_000);
    });

    it('should have medium preset', () => {
      const presets = service.get('presets');
      const medium = presets.find(p => p.id === 'medium');
      expect(medium).toBeDefined();
      expect(medium?.maxWidth).toBe(1280);
      expect(medium?.maxBitrate).toBe(2_500_000);
    });

    it('should have high preset', () => {
      const presets = service.get('presets');
      const high = presets.find(p => p.id === 'high');
      expect(high).toBeDefined();
      expect(high?.maxWidth).toBe(1920);
      expect(high?.maxBitrate).toBe(5_000_000);
    });

    it('should have veryHigh preset', () => {
      const presets = service.get('presets');
      const veryHigh = presets.find(p => p.id === 'veryHigh');
      expect(veryHigh).toBeDefined();
      expect(veryHigh?.maxWidth).toBe(1920);
      expect(veryHigh?.maxBitrate).toBe(8_000_000);
      expect(veryHigh?.audioChannels).toBe(6);
    });
  });
});
