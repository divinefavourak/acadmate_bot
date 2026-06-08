import type { NextFunction, Response } from 'express';
import type { AuthService } from '@/services/auth.service';
import { UnauthorizedError, ForbiddenError } from '@/utils/errors';
import type { AuthedRequest } from '../http';

/**
 * Verifies the Bearer access token and attaches the decoded admin to the
 * request. Throws (handled centrally) on any failure — no silent pass-through.
 */
export function authenticate(auth: AuthService) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    req.admin = auth.verifyAccessToken(token);
    next();
  };
}

/**
 * Role gate. Use after `authenticate`. SUPER_ADMIN implicitly satisfies any
 * requirement; otherwise the admin's role must be in the allow-list.
 */
export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const role = req.admin?.role;
    if (!role) throw new UnauthorizedError();
    if (role === 'SUPER_ADMIN' || roles.includes(role)) return next();
    throw new ForbiddenError('Insufficient role');
  };
}
