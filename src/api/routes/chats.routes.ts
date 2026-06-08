import { Router } from 'express';
import { z } from 'zod';
import { ModerationActionType } from '@prisma/client';
import type { AppContainer } from '@/container';
import { asyncHandler, serialize } from '../http';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { NotFoundError } from '@/utils/errors';

const settingsSchema = z
  .object({
    spamDetection: z.boolean(),
    floodDetection: z.boolean(),
    duplicateDetection: z.boolean(),
    scamLinkDetection: z.boolean(),
    bannedWordsFilter: z.boolean(),
    floodMaxMessages: z.number().int().positive(),
    floodWindowSeconds: z.number().int().positive(),
    duplicateWindowSeconds: z.number().int().positive(),
    warnThreshold: z.number().int().positive(),
    warnAction: z.nativeEnum(ModerationActionType),
    defaultMuteMinutes: z.number().int().positive(),
    deleteOnDetect: z.boolean(),
  })
  .partial();

/**
 * Chat administration for the dashboard.
 *   GET   /chats               list chats with member counts
 *   GET   /chats/:id           chat detail + settings
 *   PATCH /chats/:id/settings  update moderation config (ADMIN+)
 */
export function chatsRoutes(container: AppContainer): Router {
  const router = Router();
  router.use(authenticate(container.auth));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const chats = await container.prisma.chat.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true, logs: true } }, settings: true },
      });
      res.json(serialize(chats));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const chat = await container.prisma.chat.findUnique({
        where: { id: req.params.id },
        include: {
          settings: true,
          bannedWords: true,
          tagRoles: { include: { _count: { select: { members: true } } } },
          scheduledTags: true,
          _count: { select: { members: true } },
        },
      });
      if (!chat) throw new NotFoundError('Chat not found');
      res.json(serialize(chat));
    }),
  );

  router.patch(
    '/:id/settings',
    requireRole('ADMIN'),
    asyncHandler(async (req, res) => {
      const patch = settingsSchema.parse(req.body);
      const chat = await container.prisma.chat.findUnique({ where: { id: req.params.id } });
      if (!chat) throw new NotFoundError('Chat not found');

      const settings = await container.prisma.chatSettings.update({
        where: { chatId: chat.id },
        data: patch,
      });
      // Keep the banned-word cache honest if the filter was toggled.
      container.bannedWords.invalidate(chat.id);
      res.json(serialize(settings));
    }),
  );

  return router;
}
