import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyToken, extractBearerToken, hashPassword, comparePassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 });

    const payload = verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { currentPassword, newPassword } = await req.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    }

    // Password strength validation (same as registration)
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return NextResponse.json({ error: 'Password must contain at least 1 uppercase letter' }, { status: 400 });
    }
    if (!/[a-z]/.test(newPassword)) {
      return NextResponse.json({ error: 'Password must contain at least 1 lowercase letter' }, { status: 400 });
    }
    if (!/[0-9]/.test(newPassword)) {
      return NextResponse.json({ error: 'Password must contain at least 1 digit' }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json({ error: 'New password must be different from current password' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const valid = await comparePassword(currentPassword, user.password);
    if (!valid) return NextResponse.json({ error: 'Current password incorrect' }, { status: 400 });

    const now = new Date();
    await prisma.user.update({
      where: { id: payload.userId },
      data: {
        password: await hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: now,
      },
    });

    // Log password change as security event
    await prisma.notification.create({
      data: {
        userId: payload.userId,
        type: 'SECURITY',
        priority: 'HIGH',
        title: 'Password Changed',
        message: 'Your password was changed successfully.',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        phone: user.phone,
        agentId: user.agentId,
        mustChangePassword: false,
        passwordChangedAt: now.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}