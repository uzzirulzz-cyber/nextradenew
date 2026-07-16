import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { authenticate } from '@/lib/rbac';

// POST /api/admin/reset — wipe all dummy data, zero balances, keep admins + agents + codes
export async function POST(req: NextRequest) {
  try {
    // ── Auth check ────────────────────────────────────────────
    const { response } = authenticate(req, ['SUPER_ADMIN']);
    if (response) return response;

    // ── Execute reset in a transaction ─────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      const counts: Record<string, number> = {};

      // 1. Delete all trades
      const deletedTrades = await tx.trade.deleteMany({});
      counts.trades = deletedTrades.count;

      // 2. Delete all transactions
      const deletedTxns = await tx.transaction.deleteMany({});
      counts.transactions = deletedTxns.count;

      // 3. Delete all notifications
      const deletedNotifs = await tx.notification.deleteMany({});
      counts.notifications = deletedNotifs.count;

      // 4. Delete all referrals
      const deletedRefs = await tx.referral.deleteMany({});
      counts.referrals = deletedRefs.count;

      // 5. Delete all wallet balances, then wallets, then recreate with zero
      await tx.walletBalance.deleteMany({});
      const deletedWallets = await tx.wallet.deleteMany({});
      counts.wallets = deletedWallets.count;

      // 6. Delete all regular users (keep SUPER_ADMIN and SUB_AGENT)
      const deletedUsers = await tx.user.deleteMany({
        where: {
          role: 'USER',
        },
      });
      counts.users = deletedUsers.count;

      // 7. Get all remaining users (admins + agents)
      const remainingUsers = await tx.user.findMany({
        select: { id: true },
      });

      // 8. Create fresh zero-balance wallets for remaining users
      let walletsCreated = 0;
      for (const user of remainingUsers) {
        await tx.wallet.create({
          data: {
            userId: user.id,
            type: 'SPOT',
            totalEquity: 0,
            balances: {
              create: { currency: 'USDT', amount: 0, frozen: 0 },
            },
          },
        });
        walletsCreated++;
      }

      // 9. Reset USER invitation codes: set all UNUSED, clear usedBy/usedAt (AGENT_CODE codes stay untouched)
      const resetCodes = await tx.invitationCode.updateMany({
        where: {
          role: 'USER',
        },
        data: {
          status: 'UNUSED',
          usedBy: null,
          usedAt: null,
        },
      });
      counts.invitationCodesReset = resetCodes.count;

      // 10. Reset admin/agent wallet balances to zero too
      await tx.walletBalance.deleteMany({});
      await tx.wallet.deleteMany({});
      for (const user of remainingUsers) {
        await tx.wallet.create({
          data: {
            userId: user.id,
            type: 'SPOT',
            totalEquity: 0,
            balances: {
              create: { currency: 'USDT', amount: 0, frozen: 0 },
            },
          },
        });
      }

      counts.remainingUsers = remainingUsers.length;
      counts.walletsRecreated = remainingUsers.length;

      return counts;
    });

    return NextResponse.json({
      success: true,
      message: 'Platform reset complete. All dummy data cleared.',
      deleted: result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Reset failed';
    console.error('Reset error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}