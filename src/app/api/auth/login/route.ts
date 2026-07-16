import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { comparePassword, signToken } from '@/lib/auth';
import { seedDatabase } from '@/lib/seed';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function POST(req: NextRequest) {
  try {
    // Auto-seed on first login
    await seedDatabase();

    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null;
    const userAgent = req.headers.get('user-agent') || null;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Log failed attempt
    if (!user) {
      await prisma.loginLog.create({
        data: { userId: '', email: email.toLowerCase(), success: false, ip: ip || undefined, userAgent: userAgent || undefined },
      });
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (user.status === 'SUSPENDED') {
      await prisma.loginLog.create({
        data: { userId: user.id, email: user.email, success: false, ip: ip || undefined, userAgent: userAgent || undefined },
      });
      return NextResponse.json({ error: 'Account suspended' }, { status: 403 });
    }
    if (user.status === 'LOCKED') {
      await prisma.loginLog.create({
        data: { userId: user.id, email: user.email, success: false, ip: ip || undefined, userAgent: userAgent || undefined },
      });
      return NextResponse.json({ error: 'Account locked. Contact administrator.' }, { status: 403 });
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      // Count recent failed attempts
      const recentFailures = await prisma.loginLog.count({
        where: {
          userId: user.id,
          success: false,
          createdAt: { gte: new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000) },
        },
      });

      await prisma.loginLog.create({
        data: { userId: user.id, email: user.email, success: false, ip: ip || undefined, userAgent: userAgent || undefined },
      });

      // Lock account after MAX_FAILED_ATTEMPTS
      if (recentFailures + 1 >= MAX_FAILED_ATTEMPTS) {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'LOCKED' },
        });
        return NextResponse.json({ error: `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Contact administrator.` }, { status: 403 });
      }

      const remaining = MAX_FAILED_ATTEMPTS - (recentFailures + 1);
      return NextResponse.json({ error: `Invalid credentials. ${remaining} attempt(s) remaining.` }, { status: 401 });
    }

    // Successful login — reset any lockout concerns
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    await prisma.loginLog.create({
      data: { userId: user.id, email: user.email, success: true, ip: ip || undefined, userAgent: userAgent || undefined },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      agentId: user.agentId || undefined,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        phone: user.phone,
        agentId: user.agentId,
        invitationCode: user.invitationCode,
        mustChangePassword: user.mustChangePassword,
        passwordChangedAt: user.passwordChangedAt,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}