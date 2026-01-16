import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { JellyfinService, createJellyfinService } from '../services/jellyfin.service';
import { settingsService } from '../services/settings.service';

const router = Router();

// Test connection to Jellyfin server
router.post('/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serverUrl } = req.body;

    if (!serverUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Server URL is required'
      });
    }

    const jellyfin = new JellyfinService(serverUrl);
    const serverInfo = await jellyfin.testConnection();

    res.json({
      success: true,
      server: {
        name: serverInfo.ServerName,
        version: serverInfo.Version,
        id: serverInfo.Id
      }
    });
  } catch (err) {
    next(err);
  }
});

// Login with Jellyfin credentials
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serverUrl, username, password } = req.body;

    if (!serverUrl || !username) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Server URL and username are required'
      });
    }

    const deviceId = uuidv4();
    const jellyfin = new JellyfinService(serverUrl, undefined, undefined, deviceId);

    const authResult = await jellyfin.authenticate(username, password || '');

    // Store session data
    req.session.jellyfin = {
      serverUrl: serverUrl.replace(/\/$/, ''),
      accessToken: authResult.AccessToken,
      userId: authResult.User.Id,
      serverId: authResult.ServerId,
      deviceId: deviceId,
      username: authResult.User.Name
    };

    res.json({
      success: true,
      user: {
        id: authResult.User.Id,
        name: authResult.User.Name
      },
      serverId: authResult.ServerId
    });
  } catch (err) {
    next(err);
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        error: 'Logout Failed',
        message: 'Could not destroy session'
      });
    }
    res.json({ success: true });
  });
});

// Get current session info
router.get('/session', (req: Request, res: Response) => {
  if (!req.session.jellyfin) {
    return res.json({
      authenticated: false
    });
  }

  res.json({
    authenticated: true,
    user: {
      id: req.session.jellyfin.userId,
      name: req.session.jellyfin.username
    },
    serverUrl: req.session.jellyfin.serverUrl
  });
});

// Get Jellyfin server system info including hardware acceleration status
router.get('/system-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.session.jellyfin?.accessToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Please log in to access this resource'
      });
    }

    const jellyfin = createJellyfinService(req.session.jellyfin);
    const systemInfo = await jellyfin.getSystemInfo();

    res.json(systemInfo);
  } catch (err) {
    next(err);
  }
});

// ============================================
// Saved Servers Management
// ============================================

// Get all saved servers
router.get('/servers', async (_req: Request, res: Response) => {
  const servers = settingsService.getSavedServers();
  res.json({ servers });
});

// Add a new saved server (called after successful login)
router.post('/servers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, serverUrl, username } = req.body;

    if (!name || !serverUrl || !username) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'name, serverUrl, and username are required'
      });
    }

    const server = await settingsService.addServer({
      name,
      serverUrl: serverUrl.replace(/\/$/, ''),
      username,
      lastUsed: new Date()
    });

    res.json({ server });
  } catch (err) {
    next(err);
  }
});

// Remove a saved server
router.delete('/servers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await settingsService.removeServer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Login to a saved server (requires password)
router.post('/servers/:id/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body;
    const server = settingsService.getServerById(req.params.id);

    if (!server) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Server not found'
      });
    }

    const deviceId = uuidv4();
    const jellyfin = new JellyfinService(server.serverUrl, undefined, undefined, deviceId);

    const authResult = await jellyfin.authenticate(server.username, password || '');

    // Store session data
    req.session.jellyfin = {
      serverUrl: server.serverUrl,
      accessToken: authResult.AccessToken,
      userId: authResult.User.Id,
      serverId: authResult.ServerId,
      deviceId,
      username: authResult.User.Name
    };

    // Update last used time
    await settingsService.updateServerLastUsed(server.id);

    res.json({
      success: true,
      user: {
        id: authResult.User.Id,
        name: authResult.User.Name
      },
      serverName: server.name
    });
  } catch (err: any) {
    if (err.response?.status === 401) {
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid password'
      });
    }
    next(err);
  }
});

export default router;
