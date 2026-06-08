import type { NextFunction, Request, Response } from 'express';
import type { AccessTokenPayload } from '@/types';

/** Express request augmented with the authenticated admin (set by auth mw). */
export interface AuthedRequest extends Request {
  admin?: AccessTokenPayload;
}

/**
 * Wraps an async route handler so rejected promises are forwarded to Express's
 * error middleware instead of crashing the process or hanging the request.
 */
export function asyncHandler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req as AuthedRequest, res, next).catch(next);
  };
}

/** Convert BigInt fields to strings so JSON.stringify doesn't throw. */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}
