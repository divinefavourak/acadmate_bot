import { PrismaClient } from '@prisma/client';
import { isProduction } from '@/config';

/**
 * Single shared PrismaClient. Instantiating more than one exhausts the
 * Postgres connection pool, so we keep exactly one per process and reuse it.
 *
 * In dev with hot-reload (tsx watch), we cache the client on `globalThis`
 * to avoid spawning a new pool on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['error', 'warn'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

export type Database = PrismaClient;

/** Graceful disconnect used by entrypoint shutdown handlers. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
