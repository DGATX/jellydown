import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { settingsService } from '../services/settings.service';

const router = Router();

// Settings routes require authentication
router.use(requireAuth);

// Get all settings
router.get('/', (_req: Request, res: Response) => {
  const settings = settingsService.getAll();
  res.json(settings);
});

// Update settings
router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await settingsService.update(req.body);
    res.json({ success: true, settings: settingsService.getAll() });
  } catch (err) {
    if ((err as Error).message.includes('must be between')) {
      return res.status(400).json({ error: (err as Error).message });
    }
    next(err);
  }
});

export default router;
