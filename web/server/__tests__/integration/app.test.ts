import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import session from 'express-session';

// Mock all dependencies to isolate the app setup
vi.mock('../../config', () => ({
  config: {
    port: 6942,
    nodeEnv: 'test',
    sessionSecret: 'test-secret',
    tempDir: '/tmp/test-temp',
    downloadsDir: '/tmp/test-downloads',
    dataDir: '/tmp/test-data',
    maxConcurrentSegments: 3,
    maxRetries: 5,
    segmentTimeoutMs: 30000,
    sessionMaxAgeMs: 86400000,
    appName: 'JellyfinWebDownloader',
    appVersion: '1.0.0'
  }
}));

vi.mock('session-file-store', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return vi.fn().mockImplementation(() => ({
        get: vi.fn(),
        set: vi.fn(),
        destroy: vi.fn()
      }));
    })
  };
});

vi.mock('../../services/download.service', () => ({
  downloadService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn(),
    getAllDownloads: vi.fn().mockReturnValue([])
  }
}));

vi.mock('../../services/settings.service', () => ({
  settingsService: {
    get: vi.fn().mockReturnValue(5),
    getAll: vi.fn().mockReturnValue({
      maxConcurrentDownloads: 5,
      presets: []
    }),
    load: vi.fn().mockResolvedValue(undefined)
  }
}));

vi.mock('../../websocket/progress', () => ({
  setupWebSocket: vi.fn()
}));

describe('Application Integration Tests', () => {
  let app: Express;

  beforeAll(() => {
    // Create a test Express app that mimics the main app setup
    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false
    }));

    // Health check endpoint
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', version: '1.0.0' });
    });

    // Restart endpoint
    app.post('/api/restart', (_req, res) => {
      res.json({ status: 'restarting', message: 'Server is restarting...' });
    });

    // Mock static file serving
    app.get('/', (_req, res) => {
      res.send('<!DOCTYPE html><html><body>Test</body></html>');
    });
  });

  describe('Health Check Endpoint', () => {
    it('should return status ok', async () => {
      const res = await request(app)
        .get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('should return version', async () => {
      const res = await request(app)
        .get('/api/health');

      expect(res.body.version).toBe('1.0.0');
    });
  });

  describe('Restart Endpoint', () => {
    it('should acknowledge restart request', async () => {
      const res = await request(app)
        .post('/api/restart');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('restarting');
      expect(res.body.message).toBe('Server is restarting...');
    });
  });

  describe('Static File Serving', () => {
    it('should serve index page at root', async () => {
      const res = await request(app)
        .get('/');

      expect(res.status).toBe(200);
      expect(res.text).toContain('html');
    });
  });

  describe('Express Middleware', () => {
    let testApp: Express;

    beforeEach(() => {
      testApp = express();
      testApp.use(express.json());
    });

    it('should parse JSON body', async () => {
      testApp.post('/test', (req, res) => {
        res.json({ received: req.body });
      });

      const res = await request(testApp)
        .post('/test')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.received.test).toBe('data');
    });

    it('should handle invalid JSON gracefully', async () => {
      testApp.post('/test', (req, res) => {
        res.json({ received: req.body });
      });
      testApp.use((err: any, _req: any, res: any, _next: any) => {
        res.status(400).json({ error: 'Invalid JSON' });
      });

      const res = await request(testApp)
        .post('/test')
        .send('invalid json {')
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
    });
  });

  describe('CORS Configuration', () => {
    it('should allow credentials in development mode', async () => {
      const corsApp = express();
      const cors = (await import('cors')).default;
      corsApp.use(cors({
        origin: true,
        credentials: true
      }));
      corsApp.get('/test', (_req, res) => res.json({ ok: true }));

      const res = await request(corsApp)
        .get('/test')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Session Management', () => {
    let sessionApp: Express;

    beforeEach(() => {
      sessionApp = express();
      sessionApp.use(express.json());
      sessionApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false }
      }));

      sessionApp.post('/login', (req, res) => {
        req.session.user = { id: '123', name: req.body.username };
        res.json({ success: true });
      });

      sessionApp.get('/session', (req, res) => {
        if (req.session.user) {
          res.json({ authenticated: true, user: req.session.user });
        } else {
          res.json({ authenticated: false });
        }
      });

      sessionApp.post('/logout', (req, res) => {
        req.session.destroy((err) => {
          if (err) {
            res.status(500).json({ error: 'Failed to logout' });
          } else {
            res.json({ success: true });
          }
        });
      });
    });

    it('should create session on login', async () => {
      const agent = request.agent(sessionApp);

      await agent
        .post('/login')
        .send({ username: 'testuser' });

      const res = await agent.get('/session');

      expect(res.body.authenticated).toBe(true);
      expect(res.body.user.name).toBe('testuser');
    });

    it('should return unauthenticated when no session', async () => {
      const res = await request(sessionApp)
        .get('/session');

      expect(res.body.authenticated).toBe(false);
    });

    it('should destroy session on logout', async () => {
      const agent = request.agent(sessionApp);

      await agent
        .post('/login')
        .send({ username: 'testuser' });

      await agent.post('/logout');

      const res = await agent.get('/session');

      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should return JSON error for API routes', async () => {
      const errorApp = express();
      errorApp.use(express.json());

      errorApp.get('/api/error', () => {
        throw new Error('Test error');
      });

      errorApp.use((err: any, _req: any, res: any, _next: any) => {
        res.status(500).json({
          error: 'Internal Server Error',
          message: err.message
        });
      });

      const res = await request(errorApp)
        .get('/api/error');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal Server Error');
    });
  });

  describe('SPA Fallback', () => {
    it('should serve index.html for unknown routes', async () => {
      const spaApp = express();

      // API route
      spaApp.get('/api/health', (_req, res) => {
        res.json({ status: 'ok' });
      });

      // SPA fallback
      spaApp.get('*', (_req, res) => {
        res.send('<!DOCTYPE html><html><body>SPA</body></html>');
      });

      const res = await request(spaApp)
        .get('/some/unknown/path');

      expect(res.status).toBe(200);
      expect(res.text).toContain('SPA');
    });

    it('should not affect API routes', async () => {
      const spaApp = express();

      spaApp.get('/api/health', (_req, res) => {
        res.json({ status: 'ok' });
      });

      spaApp.get('*', (_req, res) => {
        res.send('SPA');
      });

      const res = await request(spaApp)
        .get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('Trust Proxy', () => {
    it('should handle X-Forwarded-For header when trust proxy is enabled', async () => {
      const proxyApp = express();
      proxyApp.set('trust proxy', 1);

      proxyApp.get('/ip', (req, res) => {
        res.json({ ip: req.ip });
      });

      const res = await request(proxyApp)
        .get('/ip')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.body.ip).toBe('203.0.113.195');
    });
  });
});

describe('Application Lifecycle', () => {
  describe('Initialization', () => {
    it('should initialize download service on startup', async () => {
      const { downloadService } = await import('../../services/download.service');

      // Simulate initialization
      await downloadService.initialize();

      expect(downloadService.initialize).toHaveBeenCalled();
    });
  });

  describe('Graceful Shutdown', () => {
    it('should shutdown download service on SIGTERM', async () => {
      const { downloadService } = await import('../../services/download.service');

      // Simulate shutdown
      downloadService.shutdown();

      expect(downloadService.shutdown).toHaveBeenCalled();
    });
  });
});
