import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Express error handling middleware.
 * Catches errors and returns a consistent JSON response.
 */
export const errorMiddleware: ErrorRequestHandler = (
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[Error] ${statusCode}: ${message}`);
  if (statusCode >= 500) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    error: message,
    code: err.code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Creates an API error with a status code.
 */
export function createApiError(message: string, statusCode: number, code?: string): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
