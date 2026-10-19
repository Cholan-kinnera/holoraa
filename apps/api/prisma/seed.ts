import { PrismaClient, ConversationType, ChannelType, MessageType } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Starting database seed with fake foundation data...');

  // 1. Create Demo Users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      id: 'a0000000-0000-0000-0000-000000000001',
      email: 'alice@example.com',
      username: 'alice',
      displayName: 'Alice Developer',
      bio: 'Building things at Holoraa',
      isOnline: true,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      id: 'b0000000-0000-0000-0000-000000000002',
      email: 'bob@example.com',
      username: 'bob',
      displayName: 'Bob Designer',
      bio: 'Crafting interfaces',
      isOnline: false,
    },
  });

  // 2. Create Demo Community Server
  const communityServer = await prisma.server.upsert({
    where: { id: 'c0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'c0000000-0000-0000-0000-000000000001',
      name: 'Holoraa Community',
      description: 'The official early hangout for Holoraa contributors and friends.',
      ownerId: alice.id,
      isPublic: true,
      inviteCode: 'holoraa-early',
      channels: {
        create: [
          {
            id: 'c1000000-0000-0000-0000-000000000001',
            name: 'general',
            type: ChannelType.TEXT,
            topic: 'General discussion and hangouts',
            position: 0,
          },
          {
            id: 'c2000000-0000-0000-0000-000000000002',
            name: 'voice-lounge',
            type: ChannelType.VOICE,
            topic: 'Hangout voice room',
            position: 1,
          },
        ],
      },
    },
  });

  // 3. Add Memberships
  await prisma.member.upsert({
    where: {
      serverId_userId: {
        serverId: communityServer.id,
        userId: alice.id,
      },
    },
    update: {},
    create: {
      serverId: communityServer.id,
      userId: alice.id,
      nickname: 'Alice [Founder]',
    },
  });

  await prisma.member.upsert({
    where: {
      serverId_userId: {
        serverId: communityServer.id,
        userId: bob.id,
      },
    },
    update: {},
    create: {
      serverId: communityServer.id,
      userId: bob.id,
      nickname: 'Bob',
    },
  });

  // 4. Create Demo 1:1 Conversation (DM)
  const dm = await prisma.conversation.upsert({
    where: { id: 'd0000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: 'd0000000-0000-0000-0000-000000000001',
      type: ConversationType.DM,
      createdById: alice.id,
      members: {
        create: [
          { userId: alice.id },
          { userId: bob.id },
        ],
      },
      messages: {
        create: [
          {
            id: 'm0000000-0000-0000-0000-000000000001',
            senderId: alice.id,
            type: MessageType.TEXT,
            content: 'Hey Bob! Welcome to Holoraa Phase 0.',
          },
          {
            id: 'm0000000-0000-0000-0000-000000000002',
            senderId: bob.id,
            type: MessageType.TEXT,
            content: 'Loving the clean foundation. Can’t wait for Phase 1!',
          },
        ],
      },
    },
  });

  console.log(`✅ Seed complete: Created 2 users, 1 server, 1 DM (${dm.id}) with initial messages.`);
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
