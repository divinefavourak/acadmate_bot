import { Router } from 'express';
import { z } from 'zod';
import { ModerationActionType, DetectionReason } from '@prisma/client';
import type { AppContainer } from '@/container';
import { asyncHandler, serialize } from '../http';
import { authenticate } from '../middleware/auth.middleware';

const querySchema = z.object({
  chatId: z.string().cuid().optional(),
  action: z.nativeEnum(ModerationActionType).optional(),
  reason: z.nativeEnum(DetectionReason).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

/**
 * Moderation log endpoints (read-only — the audit trail is append-only).
 *   GET /logs        paginated, filterable
 *   GET /logs/stats  aggregate counts by action
 */
export function logsRoutes(container: AppContainer): Router {
  const router = Router();
  router.use(authenticate(container.auth));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = querySchema.parse(req.query);
      const result = await container.logs.query({
        dbChatId: q.chatId,
        action: q.action,
        reason: q.reason,
        page: q.page,
        pageSize: q.pageSize,
      });
      res.json(serialize(result));
    }),
  );

  router.get(
    '/stats',
    asyncHandler(async (_req, res) => {
      const grouped = await container.prisma.moderationLog.groupBy({
        by: ['action'],
        _count: { _all: true },
      });
      res.json(
        grouped.map((g) => ({ action: g.action, count: g._count._all })),
      );
    }),
  );

  return router;
}
