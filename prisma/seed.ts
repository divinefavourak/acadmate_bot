import { PrismaClient, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seeds an initial super-admin for the dashboard.
 * Credentials come from env so secrets never live in source control.
 */
async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@acadmate.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

  const passwordHash = await bcrypt.hash(password, rounds);

  await prisma.adminUser.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Root Admin',
      role: AdminRole.SUPER_ADMIN,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded super-admin: ${email}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
