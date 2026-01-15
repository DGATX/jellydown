import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { JellyfinService } from '../services/jellyfin.service';

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

export default router;
