import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';

describe('Auth Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      session: {} as any
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    mockNext = vi.fn();
  });

  describe('requireAuth', () => {
    it('should call next() when session has valid access token', () => {
      mockRequest.session = {
        jellyfin: {
          accessToken: 'valid-token',
          serverUrl: 'http://test.local',
          userId: 'user-123',
          serverId: 'server-123',
          deviceId: 'device-123',
          username: 'testuser'
        }
      } as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('should return 401 when session is missing', () => {
      mockRequest.session = {} as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Please log in to access this resource'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when jellyfin session is missing', () => {
      mockRequest.session = { jellyfin: undefined } as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when access token is missing', () => {
      mockRequest.session = {
        jellyfin: {
          serverUrl: 'http://test.local',
          userId: 'user-123',
          serverId: 'server-123',
          deviceId: 'device-123',
          username: 'testuser'
          // accessToken is missing
        }
      } as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when access token is empty string', () => {
      mockRequest.session = {
        jellyfin: {
          accessToken: '',
          serverUrl: 'http://test.local',
          userId: 'user-123',
          serverId: 'server-123',
          deviceId: 'device-123',
          username: 'testuser'
        }
      } as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return proper error structure', () => {
      mockRequest.session = {} as any;

      requireAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(String),
          message: expect.any(String)
        })
      );
    });
  });
});
