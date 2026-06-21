import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Seed test user
  const hashedPassword = await bcrypt.hash('johndoe123', 10);
  await prisma.user.upsert({
    where: { email: 'john@doe.com' },
    update: {},
    create: {
      email: 'john@doe.com',
      name: 'John Doe',
      password: hashedPassword,
      role: 'admin',
    },
  });

  // Seed system status
  const existingStatus = await prisma.systemStatus.findFirst();
  if (!existingStatus) {
    await prisma.systemStatus.create({
      data: {
        gmailWatchActive: true,
        watchExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastWatchRenewal: new Date(),
        lastSuccessfulForm: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
  }

  console.log('Seeding complete!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
