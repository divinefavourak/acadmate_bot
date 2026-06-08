import { Router } from 'express';
import { z } from 'zod';
import type { AppContainer } from '@/container';
import { asyncHandler, serialize } from '../http';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { NotFoundError } from '@/utils/errors';

const listSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const actionSchema = z.object({
  chatId: z.string().cuid(),
  reason: z.string().max(500).optional(),
});

/**
 * Telegram user management for the dashboard.
 *   GET  /users                list/search observed users
 *   GET  /users/:id            user detail incl. warnings/mutes/bans
 *   POST /users/:id/ban        ban in a chat (ADMIN+)
 *   POST /users/:id/unban      unban in a chat (ADMIN+)
 */
export function usersRoutes(container: AppContainer): Router {
  const router = Router();
  router.use(authenticate(container.auth));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { search, page, pageSize } = listSchema.parse(req.query);
      const where = search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' as const } },
              { firstName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {};
      const [total, items] = await container.prisma.$transaction([
        container.prisma.tgUser.count({ where }),
        container.prisma.tgUser.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      res.json(serialize({ total, items }));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = await container.prisma.tgUser.findUnique({
        where: { id: req.params.id },
        include: {
          warnings: { orderBy: { createdAt: 'desc' }, take: 50 },
          mutes: { orderBy: { createdAt: 'desc' }, take: 50 },
          bans: true,
          memberships: { include: { chat: { select: { telegramId: true, title: true } } } },
        },
      });
      if (!user) throw new NotFoundError('User not found');
      res.json(serialize(user));
    }),
  );

  router.post(
    '/:id/ban',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const { chatId, reason } = actionSchema.parse(req.body);
      const { user, chat } = await resolvePair(container, req.params.id, chatId);
      await container.bans.ban({
        dbChatId: chat.id,
        dbUserId: user.id,
        chatTelegramId: chat.telegramId,
        userTelegramId: user.telegramId,
        reason: reason ?? 'Banned via dashboard',
      });
      await container.logs.record({
        dbChatId: chat.id,
        action: 'BAN',
        reason: 'MANUAL',
        targetId: user.id,
        details: `Dashboard ban by ${req.admin?.email}`,
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/:id/unban',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const { chatId } = actionSchema.parse(req.body);
      const { user, chat } = await resolvePair(container, req.params.id, chatId);
      await container.bans.unban(chat.id, user.id, chat.telegramId, user.telegramId);
      await container.logs.record({
        dbChatId: chat.id,
        action: 'UNBAN',
        reason: 'MANUAL',
        targetId: user.id,
        details: `Dashboard unban by ${req.admin?.email}`,
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

/** Loads and validates a (user, chat) pair, throwing 404 if either is missing. */
async function resolvePair(container: AppContainer, userId: string, chatId: string) {
  const [user, chat] = await Promise.all([
    container.prisma.tgUser.findUnique({ where: { id: userId } }),
    container.prisma.chat.findUnique({ where: { id: chatId } }),
  ]);
  if (!user) throw new NotFoundError('User not found');
  if (!chat) throw new NotFoundError('Chat not found');
  return { user, chat };
}
