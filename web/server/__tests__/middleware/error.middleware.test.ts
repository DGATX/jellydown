import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import { errorHandler } from '../../middleware/error.middleware';

describe('Error Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockRequest = {
      path: '/api/test',
      method: 'GET'
    };
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    mockNext = vi.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Axios Error Handling', () => {
    it('should handle 401 authentication error', () => {
      const axiosError = new Error('Request failed') as AxiosError;
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = { status: 401, data: { message: 'Unauthorized' } };

      errorHandler(axiosError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Authentication Failed',
        message: 'Invalid credentials or session expired'
      });
    });

    it('should handle 404 not found error', () => {
      const axiosError = new Error('Request failed') as AxiosError;
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = { status: 404, data: { message: 'Not found' } };

      errorHandler(axiosError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'The requested resource was not found on the Jellyfin server'
      });
    });

    it('should handle generic Axios errors with response data message', () => {
      const axiosError = new Error('Request failed') as AxiosError;
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = {
        status: 500,
        data: { message: 'Internal server error occurred' }
      };

      errorHandler(axiosError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Jellyfin API Error',
        message: 'Internal server error occurred'
      });
    });

    it('should fall back to error message when no response data', () => {
      const axiosError = new Error('Network Error') as AxiosError;
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = { status: 503, data: {} };

      errorHandler(axiosError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Jellyfin API Error',
        message: 'Network Error'
      });
    });

    it('should handle Axios error with no response (default to 500)', () => {
      const axiosError = new Error('Network Error') as AxiosError;
      (axiosError as any).isAxiosError = true;
      (axiosError as any).response = undefined;

      errorHandler(axiosError, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Connection Error Handling', () => {
    it('should handle ECONNREFUSED error', () => {
      const error = new Error('connect ECONNREFUSED 192.168.1.100:8096');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Connection Failed',
        message: 'Could not connect to the Jellyfin server. Please check the URL.'
      });
    });

    it('should handle ENOTFOUND error', () => {
      const error = new Error('getaddrinfo ENOTFOUND jellyfin.local');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Connection Failed',
        message: 'Could not connect to the Jellyfin server. Please check the URL.'
      });
    });
  });

  describe('Generic Error Handling', () => {
    it('should return error message in development mode', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('Something went wrong internally');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Something went wrong internally'
      });
    });

    it('should hide error message in production mode', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Something went wrong internally');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    });

    it('should hide sensitive details in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('Database credentials exposed: password=secret123');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    });
  });

  describe('Error Logging', () => {
    it('should not call next middleware after handling error', () => {
      const error = new Error('Test error');

      errorHandler(error, mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});
