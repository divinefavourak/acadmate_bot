import { config } from '@/config';
import { buildBot } from './setup';
import { disconnectPrisma } from '@/database/prisma.client';
import { logger } from '@/utils/logger';

/**
 * Bot process entrypoint. Supports long-polling (dev) and webhook (prod).
 * Starts the scheduler, installs graceful-shutdown handlers, then launches.
 *
 * NOTE: in polling mode `bot.launch()` resolves only once the bot STOPS, so we
 * must not `await` it before doing our own setup — handlers and the scheduler
 * are wired up first, and launch is fired without blocking.
 */
async function main(): Promise<void> {
  const { bot, container } = buildBot();

  // Rehydrate scheduled tags and start maintenance loops.
  await container.scheduler.start();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down bot');
    bot.stop(signal);
    container.scheduler.stop();
    void disconnectPrisma().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  const launchOptions =
    config.BOT_MODE === 'webhook'
      ? {
          webhook: {
            domain: config.WEBHOOK_DOMAIN!,
            path: config.WEBHOOK_PATH,
            port: config.WEBHOOK_PORT,
            secretToken: config.WEBHOOK_SECRET,
          },
        }
      : { dropPendingUpdates: true };

  // Fire-and-forget: in polling mode this promise only settles on stop.
  void bot.launch(launchOptions).catch((err) => {
    logger.fatal({ err }, 'bot launch failed');
    process.exit(1);
  });

  logger.info({ mode: config.BOT_MODE }, 'bot launched');
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal error starting bot');
  process.exit(1);
});
