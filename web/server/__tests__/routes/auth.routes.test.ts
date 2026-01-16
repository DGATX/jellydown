import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import session from 'express-session';

// Configurable mock responses
const mockConfig = {
  testConnectionResult: null as any,
  testConnectionError: null as Error | null,
  authenticateResult: null as any,
  authenticateError: null as Error | null,
};

// Mock dependencies before importing routes
vi.mock('../../services/jellyfin.service', () => {
  // Create a constructor function that can be called with 'new'
  function MockJellyfinService(this: any, serverUrl: string) {
    this.serverUrl = serverUrl;
    this.testConnection = vi.fn().mockImplementation(async () => {
      if (mockConfig.testConnectionError) {
        throw mockConfig.testConnectionError;
      }
      return mockConfig.testConnectionResult;
    });
    this.authenticate = vi.fn().mockImplementation(async () => {
      if (mockConfig.authenticateError) {
        throw mockConfig.authenticateError;
      }
      return mockConfig.authenticateResult;
    });
    this.getSystemInfo = vi.fn();
    this.getServerUrl = () => serverUrl;
  }

  return {
    JellyfinService: MockJellyfinService,
    createJellyfinService: vi.fn().mockImplementation(() => ({
      getSystemInfo: vi.fn().mockResolvedValue({
        serverName: 'Test Server',
        version: '10.8.0',
        hardwareAccelerationEnabled: true,
        encoderLocationType: 'vaapi'
      })
    }))
  };
});

vi.mock('../../services/settings.service', () => ({
  settingsService: {
    getSavedServers: vi.fn().mockReturnValue([]),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    getServerById: vi.fn(),
    updateServerLastUsed: vi.fn()
  }
}));

import authRoutes from '../../routes/auth.routes';
import { settingsService } from '../../services/settings.service';

describe('Auth Routes', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock config
    mockConfig.testConnectionResult = null;
    mockConfig.testConnectionError = null;
    mockConfig.authenticateResult = null;
    mockConfig.authenticateError = null;

    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
    }));
    app.use('/api/auth', authRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/auth/connect', () => {
    it('should return 400 when serverUrl is missing', async () => {
      const res = await request(app)
        .post('/api/auth/connect')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toBe('Server URL is required');
    });

    it('should return server info on successful connection', async () => {
      mockConfig.testConnectionResult = {
        ServerName: 'My Jellyfin',
        Version: '10.8.0',
        Id: 'server-123'
      };

      const res = await request(app)
        .post('/api/auth/connect')
        .send({ serverUrl: 'http://jellyfin.local' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.server.name).toBe('My Jellyfin');
      expect(res.body.server.version).toBe('10.8.0');
      expect(res.body.server.id).toBe('server-123');
    });

    it('should handle connection failure', async () => {
      mockConfig.testConnectionError = new Error('Connection refused');

      const res = await request(app)
        .post('/api/auth/connect')
        .send({ serverUrl: 'http://invalid.local' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 when serverUrl is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
      expect(res.body.message).toBe('Server URL and username are required');
    });

    it('should return 400 when username is missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ serverUrl: 'http://jellyfin.local' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('should login successfully with valid credentials', async () => {
      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local',
          username: 'testuser',
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe('user-123');
      expect(res.body.user.name).toBe('testuser');
      expect(res.body.serverId).toBe('server-123');
    });

    it('should handle empty password', async () => {
      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local',
          username: 'testuser'
        });

      expect(res.status).toBe(200);
    });

    it('should handle authentication failure', async () => {
      mockConfig.authenticateError = new Error('Invalid credentials');

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local',
          username: 'testuser',
          password: 'wrongpassword'
        });

      expect(res.status).toBe(500);
    });

    it('should normalize server URL by removing trailing slash', async () => {
      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local/',
          username: 'testuser',
          password: 'password123'
        });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      const res = await request(app)
        .post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/auth/session', () => {
    it('should return unauthenticated when no session', async () => {
      const res = await request(app)
        .get('/api/auth/session');

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });

    it('should return session info when authenticated', async () => {
      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const agent = request.agent(app);

      await agent
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local',
          username: 'testuser',
          password: 'password123'
        });

      const res = await agent.get('/api/auth/session');

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.id).toBe('user-123');
      expect(res.body.user.name).toBe('testuser');
    });
  });

  describe('GET /api/auth/system-info', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .get('/api/auth/system-info');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should return system info when authenticated', async () => {
      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const agent = request.agent(app);

      await agent
        .post('/api/auth/login')
        .send({
          serverUrl: 'http://jellyfin.local',
          username: 'testuser',
          password: 'password123'
        });

      const res = await agent.get('/api/auth/system-info');

      expect(res.status).toBe(200);
      expect(res.body.serverName).toBe('Test Server');
      expect(res.body.hardwareAccelerationEnabled).toBe(true);
    });
  });

  describe('GET /api/auth/servers', () => {
    it('should return empty array when no saved servers', async () => {
      vi.mocked(settingsService.getSavedServers).mockReturnValue([]);

      const res = await request(app)
        .get('/api/auth/servers');

      expect(res.status).toBe(200);
      expect(res.body.servers).toEqual([]);
    });

    it('should return saved servers', async () => {
      const mockServers = [
        { id: 'server1', name: 'Server 1', serverUrl: 'http://server1.local', username: 'user1' },
        { id: 'server2', name: 'Server 2', serverUrl: 'http://server2.local', username: 'user2' }
      ];
      vi.mocked(settingsService.getSavedServers).mockReturnValue(mockServers);

      const res = await request(app)
        .get('/api/auth/servers');

      expect(res.status).toBe(200);
      expect(res.body.servers).toHaveLength(2);
      expect(res.body.servers[0].name).toBe('Server 1');
    });
  });

  describe('POST /api/auth/servers', () => {
    it('should return 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/auth/servers')
        .send({ serverUrl: 'http://server.local', username: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('should return 400 when serverUrl is missing', async () => {
      const res = await request(app)
        .post('/api/auth/servers')
        .send({ name: 'Test Server', username: 'user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('should return 400 when username is missing', async () => {
      const res = await request(app)
        .post('/api/auth/servers')
        .send({ name: 'Test Server', serverUrl: 'http://server.local' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('should add server successfully', async () => {
      const mockServer = {
        id: 'new-server-id',
        name: 'New Server',
        serverUrl: 'http://newserver.local',
        username: 'newuser'
      };
      vi.mocked(settingsService.addServer).mockResolvedValue(mockServer);

      const res = await request(app)
        .post('/api/auth/servers')
        .send({
          name: 'New Server',
          serverUrl: 'http://newserver.local/',
          username: 'newuser'
        });

      expect(res.status).toBe(200);
      expect(res.body.server.id).toBe('new-server-id');
      expect(settingsService.addServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Server',
          serverUrl: 'http://newserver.local',
          username: 'newuser'
        })
      );
    });
  });

  describe('DELETE /api/auth/servers/:id', () => {
    it('should remove server successfully', async () => {
      vi.mocked(settingsService.removeServer).mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/auth/servers/server-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(settingsService.removeServer).toHaveBeenCalledWith('server-123');
    });
  });

  describe('POST /api/auth/servers/:id/login', () => {
    it('should return 404 when server not found', async () => {
      vi.mocked(settingsService.getServerById).mockReturnValue(undefined);

      const res = await request(app)
        .post('/api/auth/servers/nonexistent/login')
        .send({ password: 'password123' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not Found');
    });

    it('should login to saved server successfully', async () => {
      const mockServer = {
        id: 'server-123',
        name: 'Test Server',
        serverUrl: 'http://test.local',
        username: 'testuser'
      };
      vi.mocked(settingsService.getServerById).mockReturnValue(mockServer);
      vi.mocked(settingsService.updateServerLastUsed).mockResolvedValue(undefined);

      mockConfig.authenticateResult = {
        AccessToken: 'token-123',
        User: { Id: 'user-123', Name: 'testuser' },
        ServerId: 'server-123'
      };

      const res = await request(app)
        .post('/api/auth/servers/server-123/login')
        .send({ password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.name).toBe('testuser');
      expect(res.body.serverName).toBe('Test Server');
      expect(settingsService.updateServerLastUsed).toHaveBeenCalledWith('server-123');
    });

    it('should return 401 for invalid password', async () => {
      const mockServer = {
        id: 'server-123',
        name: 'Test Server',
        serverUrl: 'http://test.local',
        username: 'testuser'
      };
      vi.mocked(settingsService.getServerById).mockReturnValue(mockServer);

      const error = new Error('Invalid credentials') as any;
      error.response = { status: 401 };
      mockConfig.authenticateError = error;

      const res = await request(app)
        .post('/api/auth/servers/server-123/login')
        .send({ password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication Failed');
      expect(res.body.message).toBe('Invalid password');
    });
  });
});
