import { Request, Response, NextFunction } from 'express';
import { AxiosError } from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Handle Axios errors (Jellyfin API errors)
  if ((err as AxiosError).isAxiosError) {
    const axiosError = err as AxiosError;
    const status = axiosError.response?.status || 500;
    const data = axiosError.response?.data as Record<string, unknown> | undefined;

    if (status === 401) {
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid credentials or session expired'
      });
    }

    if (status === 404) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'The requested resource was not found on the Jellyfin server'
      });
    }

    return res.status(status).json({
      error: 'Jellyfin API Error',
      message: data?.message || axiosError.message
    });
  }

  // Handle connection errors
  if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
    return res.status(503).json({
      error: 'Connection Failed',
      message: 'Could not connect to the Jellyfin server. Please check the URL.'
    });
  }

  // Generic error response
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
}
