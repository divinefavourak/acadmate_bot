import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { Telegraf } from 'telegraf';
import { config } from '@/config';
import { Container } from '@/container';
import { disconnectPrisma } from '@/database/prisma.client';
import { logger } from '@/utils/logger';
import { authRoutes } from './routes/auth.routes';
import { logsRoutes } from './routes/logs.routes';
import { usersRoutes } from './routes/users.routes';
import { chatsRoutes } from './routes/chats.routes';
import { errorHandler, notFound } from './middleware/error.middleware';

/**
 * Admin dashboard REST API. Runs as a separate process from the bot but shares
 * the same service layer via a Container built around a non-launched Telegraf
 * client (so dashboard-triggered bans/unbans actually reach Telegram).
 */
export function buildApiApp(container: Container): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind a reverse proxy / load balancer

  // Security headers + strict JSON body limit.
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  // Minimal hand-rolled CORS honouring the configured allow-list.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.CORS_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  // Global API throttle. Auth endpoints get a stricter limiter below.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20 });
  app.use('/api/v1/auth', authLimiter, authRoutes(container));
  app.use('/api/v1/logs', logsRoutes(container));
  app.use('/api/v1/users', usersRoutes(container));
  app.use('/api/v1/chats', chatsRoutes(container));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  // A non-launched Telegraf gives us a working Bot API client for outbound
  // actions (ban/unban) without consuming updates — that's the bot's job.
  const telegraf = new Telegraf(config.BOT_TOKEN);
  const container = new Container(telegraf.telegram);

  const app = buildApiApp(container);
  const server = app.listen(config.API_PORT, () => {
    logger.info({ port: config.API_PORT }, 'admin API listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down API');
    server.close(() => {
      void disconnectPrisma().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

// Only auto-start when run directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ err }, 'fatal error starting API');
    process.exit(1);
  });
}
