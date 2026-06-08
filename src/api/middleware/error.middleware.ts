import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '@/utils/errors';
import { isProduction } from '@/config';
import { scopedLogger } from '@/utils/logger';

const log = scopedLogger('api-error');

/** 404 fallthrough for unmatched routes. */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

/**
 * Central error handler. Maps known error types to clean HTTP responses and
 * never leaks stack traces or internal messages to clients in production.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
    return;
  }

  if (err instanceof AppError) {
    if (!err.isOperational) log.error({ err }, 'non-operational AppError');
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint, etc. Don't echo the raw Prisma message to clients.
    const status = err.code === 'P2002' ? 409 : 400;
    res.status(status).json({ error: { code: `DB_${err.code}`, message: 'Database constraint error' } });
    return;
  }

  log.error({ err }, 'unhandled API error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Internal server error' : String((err as Error)?.message ?? err),
    },
  });
}
