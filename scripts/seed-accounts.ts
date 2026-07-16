import prisma from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';

const SEED_PASSWORD = 'bixby1122!!';

const SUB_AGENTS = [
  { name: 'SubAgent 1', email: 'subagent1@trade.com',  code: 'PB-AG001' },
  { name: 'SubAgent 2', email: 'subagent2@trade2.com', code: 'PB-AG002' },
  { name: 'SubAgent 3', email: 'subagent3@trade3.com', code: 'PB-AG003' },
  { name: 'SubAgent 4', email: 'subagent4@trade4.com', code: 'PB-AG004' },
  { name: 'SubAgent 5', email: 'subagent5@trade5.com', code: 'PB-AG005' },
];

async function main() {
  const pw = await hashPassword(SEED_PASSWORD);

  // Clean up old sub-agents with wrong emails
  const oldEmails = ['subagent2@trade.com','subagent3@trade.com','subagent4@trade.com','subagent5@trade.com'];
  for (const e of oldEmails) {
    const u = await prisma.user.findUnique({ where: { email: e } });
    if (u) {
      console.log('Deleting old user:', e);
      await prisma.user.delete({ where: { email: e } });
    }
  }

  // Clean up old codes with wrong role
  await prisma.invitationCode.deleteMany({ where: { role: 'SUB_AGENT' } });
  // Clean up old per-agent user codes (PB-AG00X-UYYY)
  await prisma.invitationCode.deleteMany({ where: { code: { contains: '-U' } } });

  // Super Admin
  let admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: { name: 'Super Admin', email: 'crdbixx@gmail.com', password: pw, role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: true, passwordChangedAt: null },
    });
    await prisma.wallet.create({
      data: { userId: admin.id, type: 'SPOT', totalEquity: 1000000 + 10*67000 + 100*3500,
        balances: { create: [
          { currency: 'USDT', amount: 1000000, frozen: 0 },
          { currency: 'BTC', amount: 10, frozen: 0 },
          { currency: 'ETH', amount: 100, frozen: 0 },
        ]}
      },
    });
    console.log('Created Super Admin:', admin.email);
  } else {
    await prisma.user.update({ where: { id: admin.id }, data: { password: pw, mustChangePassword: true, passwordChangedAt: null } });
    console.log('Updated Super Admin:', admin.email);
  }

  // Sub-Agents
  for (const def of SUB_AGENTS) {
    let agent = await prisma.user.findUnique({ where: { email: def.email } });
    if (!agent) {
      agent = await prisma.user.create({
        data: { name: def.name, email: def.email, password: pw, role: 'SUB_AGENT', status: 'ACTIVE', agentId: admin!.id, mustChangePassword: true, passwordChangedAt: null },
      });
      await prisma.wallet.create({
        data: { userId: agent.id, type: 'SPOT', totalEquity: 10000 + 0.5*67000,
          balances: { create: [
            { currency: 'USDT', amount: 10000, frozen: 0 },
            { currency: 'BTC', amount: 0.5, frozen: 0 },
          ]}
        },
      });
      console.log('Created', def.name, ':', def.email);
    } else {
      await prisma.user.update({ where: { id: agent.id }, data: { password: pw, mustChangePassword: true, passwordChangedAt: null } });
      console.log('Updated', def.name, ':', def.email);
    }
    await prisma.agentConfig.upsert({
      where: { agentId: agent.id },
      update: {},
      create: { agentId: agent.id, commissionRate: 0.15, referralRate: 0.05, maxUsers: 100, maxLeverage: 100, allowedSymbols: ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'], riskLimit: 100000 },
    });
    // Reusable invitation code (AGENT_CODE)
    await prisma.invitationCode.upsert({
      where: { code: def.code },
      update: { createdBy: agent.id, role: 'AGENT_CODE', status: 'UNUSED', usedBy: null, usedAt: null },
      create: { code: def.code, role: 'AGENT_CODE', createdBy: agent.id, status: 'UNUSED' },
    });
  }

  // Verify
  const users = await prisma.user.findMany({ select: { name: true, email: true, role: true, mustChangePassword: true, passwordChangedAt: true }, orderBy: { createdAt: 'asc' } });
  const codes = await prisma.invitationCode.findMany({ select: { code: true, role: true, createdBy: true, status: true } });
  console.log('\n=== Seeded Users ===');
  for (const u of users) console.log(u);
  console.log('\n=== Invitation Codes ===');
  for (const c of codes) console.log(c);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });