import prisma from './db';
import { hashPassword } from './auth';

const SEED_PASSWORD = 'bixby1122!!';

const SUB_AGENTS = [
  { name: 'SubAgent 1', email: 'subagent1@trade.com',  code: 'PB-AG001' },
  { name: 'SubAgent 2', email: 'subagent2@trade2.com', code: 'PB-AG002' },
  { name: 'SubAgent 3', email: 'subagent3@trade3.com', code: 'PB-AG003' },
  { name: 'SubAgent 4', email: 'subagent4@trade4.com', code: 'PB-AG004' },
  { name: 'SubAgent 5', email: 'subagent5@trade5.com', code: 'PB-AG005' },
];

export async function seedDatabase() {
  const results: string[] = [];

  // ── Super Admin ──────────────────────────────────────────────
  const adminPw = await hashPassword(SEED_PASSWORD);
  let admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: 'crdbixx@gmail.com',
        password: adminPw,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,   // Force password change on first login
        passwordChangedAt: null,     // Never changed — seeded
      },
    });
    results.push(`Created Super Admin: ${admin.email}`);

    // Admin wallet
    await prisma.wallet.create({
      data: {
        userId: admin.id,
        type: 'SPOT',
        totalEquity: 1000000 + 10 * 67000 + 100 * 3500,
        balances: {
          create: [
            { currency: 'USDT', amount: 1000000, frozen: 0 },
            { currency: 'BTC', amount: 10, frozen: 0 },
            { currency: 'ETH', amount: 100, frozen: 0 },
          ],
        },
      },
    });
  } else {
    // Update existing admin password & flags if needed
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        password: adminPw,
        mustChangePassword: true,
        passwordChangedAt: null,
      },
    });
    results.push(`Updated Super Admin: ${admin.email}`);
  }

  // ── 5 Sub-Agents ───────────────────────────────────────────
  const agentPw = await hashPassword(SEED_PASSWORD);
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];

  for (const agentDef of SUB_AGENTS) {
    const existing = await prisma.user.findUnique({ where: { email: agentDef.email } });

    let agent;
    if (!existing) {
      agent = await prisma.user.create({
        data: {
          name: agentDef.name,
          email: agentDef.email,
          password: agentPw,
          role: 'SUB_AGENT',
          status: 'ACTIVE',
          agentId: admin!.id,
          mustChangePassword: true,   // Force password change on first login
          passwordChangedAt: null,
        },
      });
      results.push(`Created ${agentDef.name}: ${agentDef.email}`);

      // Wallet for agent
      await prisma.wallet.create({
        data: {
          userId: agent.id,
          type: 'SPOT',
          totalEquity: 10000 + 0.5 * 67000,
          balances: {
            create: [
              { currency: 'USDT', amount: 10000, frozen: 0 },
              { currency: 'BTC', amount: 0.5, frozen: 0 },
            ],
          },
        },
      });
    } else {
      agent = existing;
      // Update password and flags
      await prisma.user.update({
        where: { id: agent.id },
        data: {
          password: agentPw,
          mustChangePassword: true,
          passwordChangedAt: null,
        },
      });
      results.push(`Updated ${agentDef.name}: ${agentDef.email}`);
    }

    // Agent config
    await prisma.agentConfig.upsert({
      where: { agentId: agent.id },
      update: {},
      create: {
        agentId: agent.id,
        commissionRate: 0.15,
        referralRate: 0.05,
        maxUsers: 100,
        maxLeverage: 100,
        allowedSymbols: symbols,
        riskLimit: 100000,
      },
    });

    // Sub-Agent's reusable invitation code (AGENT_CODE = permanent, never marked USED)
    await prisma.invitationCode.upsert({
      where: { code: agentDef.code },
      update: {
        // Ensure createdBy points to the Sub-Agent (not admin)
        createdBy: agent.id,
        role: 'AGENT_CODE',
        status: 'UNUSED', // Always stays UNUSED — reusable
        usedBy: null,
        usedAt: null,
      },
      create: {
        code: agentDef.code,
        role: 'AGENT_CODE',  // Reusable Sub-Agent code
        createdBy: agent.id, // Owner = the Sub-Agent themselves
        status: 'UNUSED',
      },
    });
  }

  return {
    message: results.length ? `Seeded: ${results.join('; ')}` : 'Database already up to date',
    details: results,
  };
}