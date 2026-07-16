/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { authenticate, customerWhereFilter } from '@/lib/rbac';

// GET /api/admin/users — paginated user list with search & role filter
export async function GET(request: NextRequest) {
  try {
    const { payload, response } = authenticate(request, ['SUPER_ADMIN', 'SUB_AGENT']);
    if (response) return response;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const search = searchParams.get('search') || '';
    const role = searchParams.get('role') || '';
    const status = searchParams.get('status') || '';

    const where: any = customerWhereFilter(payload!);
    if (role) where.role = role;
    if (status) where.status = status;

    if (search) {
      const searchClause = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      };
      if (where.OR) {
        // Combine agent filter with search using AND
        where.AND = [...where.OR];
        delete where.OR;
        Object.assign(where, searchClause);
      } else {
        Object.assign(where, searchClause);
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, firstName: true, lastName: true, email: true, role: true, status: true, avatar: true, phone: true, agentId: true, invitationCode: true, mustChangePassword: true, lastLogin: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    const userIds = users.map(u => u.id);
    const wallets = await prisma.wallet.findMany({ where: { userId: { in: userIds } } });
    const walletMap = new Map<string, { totalEquity: number; walletCount: number }>();
    for (const w of wallets) {
      const existing = walletMap.get(w.userId) || { totalEquity: 0, walletCount: 0 };
      walletMap.set(w.userId, {
        totalEquity: existing.totalEquity + (w.totalEquity || 0),
        walletCount: existing.walletCount + 1,
      });
    }

    const enriched = users.map(u => ({
      ...u,
      _id: u.id,
      walletSummary: walletMap.get(u.id) || { totalEquity: 0, walletCount: 0 },
    }));

    // Stats for the stat cards
    const statsWhere = customerWhereFilter(payload!);
    const [activeCount, suspendedCount, newTodayCount] = await Promise.all([
      prisma.user.count({ where: { ...statsWhere, status: 'ACTIVE' } }),
      prisma.user.count({ where: { ...statsWhere, status: 'SUSPENDED' } }),
      prisma.user.count({
        where: { ...statsWhere, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
    ]);

    return NextResponse.json({
      users: enriched,
      total,
      stats: {
        total,
        active: activeCount,
        suspended: suspendedCount,
        newToday: newTodayCount,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/users — update user (SUPER_ADMIN only)
export async function PUT(request: NextRequest) {
  try {
    const { payload, response } = authenticate(request, ['SUPER_ADMIN']);
    if (response) return response;

    const body = await request.json();
    const { userId, status, role, phone, name, invitationCode, mustChangePassword, resetPassword } = body;
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    if (status) updateData.status = status;
    if (role) updateData.role = role;
    if (phone !== undefined) updateData.phone = phone;
    if (name) updateData.name = name;
    // Only SUPER_ADMIN can change invitationCode
    if (invitationCode !== undefined) updateData.invitationCode = invitationCode;
    // Force password change on next login
    if (mustChangePassword !== undefined) {
      updateData.mustChangePassword = mustChangePassword;
      if (mustChangePassword) updateData.passwordChangedAt = null;
    }
    // Unlock a locked account by setting status to ACTIVE
    if (status === 'ACTIVE') {
      updateData.status = 'ACTIVE';
    }

    // Admin reset password (SUPER_ADMIN only)
    if (resetPassword) {
      const { hashPassword } = await import('@/lib/auth');
      updateData.password = await hashPassword(resetPassword);
      updateData.mustChangePassword = true;
      updateData.passwordChangedAt = null;
      updateData.status = 'ACTIVE'; // Also unlock if locked
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, firstName: true, lastName: true, email: true, role: true, status: true, avatar: true, phone: true, agentId: true, invitationCode: true, mustChangePassword: true, lastLogin: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({ message: 'User updated successfully', user: { ...user, _id: user.id } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/users — delete a user (SUPER_ADMIN only)
export async function DELETE(request: NextRequest) {
  try {
    const { payload, response } = authenticate(request, ['SUPER_ADMIN']);
    if (response) return response;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Cannot delete a SUPER_ADMIN' }, { status: 400 });
    }

    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ message: 'User and associated data deleted successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('Record to delete not found')) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}