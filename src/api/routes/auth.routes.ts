import { Router } from 'express';
import { z } from 'zod';
import type { AppContainer } from '@/container';
import { asyncHandler } from '../http';
import { authenticate } from '../middleware/auth.middleware';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

/**
 * Auth endpoints:
 *   POST /auth/login    { email, password } -> tokens
 *   POST /auth/refresh  { refreshToken }    -> rotated tokens
 *   POST /auth/logout   { refreshToken }    -> revoke
 *   GET  /auth/me       (Bearer)            -> current admin
 */
export function authRoutes(container: AppContainer): Router {
  const router = Router();

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, password } = credentialsSchema.parse(req.body);
      const { admin, tokens } = await container.auth.login(email, password);
      res.json({ admin, ...tokens });
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const { refreshToken } = refreshSchema.parse(req.body);
      const tokens = await container.auth.refresh(refreshToken);
      res.json(tokens);
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const { refreshToken } = refreshSchema.parse(req.body);
      await container.auth.logout(refreshToken);
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    authenticate(container.auth),
    asyncHandler(async (req, res) => {
      res.json({ admin: req.admin });
    }),
  );

  return router;
}
