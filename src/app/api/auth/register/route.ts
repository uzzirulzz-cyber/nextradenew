import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, phone, password, invitationCode, name } = body;

    // Invitation code is REQUIRED for registration
    if (!invitationCode || !invitationCode.trim()) {
      return NextResponse.json({ error: 'Invitation code is required to register' }, { status: 400 });
    }

    // Support both { firstName, lastName } and legacy { name } formats
    let finalFirstName = firstName?.trim();
    let finalLastName = lastName?.trim();
    let fullName: string;

    if (finalFirstName && finalLastName) {
      fullName = `${finalFirstName} ${finalLastName}`.trim();
    } else if (name?.trim()) {
      const parts = name.trim().split(/\s+/);
      finalFirstName = parts[0] || '';
      finalLastName = parts.slice(1).join(' ') || '';
      fullName = name.trim();
    } else {
      return NextResponse.json(
        { error: 'First name, last name, email, and password are required' },
        { status: 400 }
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Password strength validation
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
    }
    if (!/[A-Z]/.test(password)) {
      return NextResponse.json({ error: 'Password must contain at least 1 uppercase letter' }, { status: 400 });
    }
    if (!/[a-z]/.test(password)) {
      return NextResponse.json({ error: 'Password must contain at least 1 lowercase letter' }, { status: 400 });
    }
    if (!/[0-9]/.test(password)) {
      return NextResponse.json({ error: 'Password must contain at least 1 digit' }, { status: 400 });
    }

    // Password must not be same as email
    if (password === email.trim()) {
      return NextResponse.json({ error: 'Password must not be the same as your email' }, { status: 400 });
    }

    // Phone format validation (optional but if provided, must be 7-15 digits)
    if (phone && phone.trim()) {
      const digitsOnly = phone.replace(/\D/g, '');
      if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        return NextResponse.json({ error: 'Phone number must be 7-15 digits' }, { status: 400 });
      }
    }

    const codeUpper = invitationCode.trim().toUpperCase();

    // Validate invitation code
    const code = await prisma.invitationCode.findUnique({
      where: { code: codeUpper },
    });
    if (!code || code.status === 'DISABLED') {
      return NextResponse.json({ error: 'Invalid or disabled invitation code' }, { status: 400 });
    }

    // For single-use USER codes, check if already used
    if (code.role === 'USER' && code.status === 'USED') {
      return NextResponse.json({ error: 'Invitation code has already been used' }, { status: 400 });
    }

    // Look up the code owner (createdBy = the Sub-Agent for AGENT_CODE, or admin/agent for USER)
    const codeOwner = await prisma.user.findUnique({ where: { id: code.createdBy } });
    if (!codeOwner || codeOwner.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Invitation code owner is inactive or not found' }, { status: 400 });
    }

    // Determine the Sub-Agent this customer belongs to
    let agentId: string;
    if (code.role === 'AGENT_CODE') {
      // Reusable Sub-Agent code — createdBy IS the Sub-Agent
      agentId = code.createdBy;
    } else {
      // Single-use USER code — createdBy could be admin or Sub-Agent
      // If createdBy is a SUB_AGENT, link to them; otherwise link to their agentId
      if (codeOwner.role === 'SUB_AGENT') {
        agentId = codeOwner.id;
      } else if (codeOwner.agentId) {
        agentId = codeOwner.agentId;
      } else {
        return NextResponse.json({ error: 'Cannot determine Sub-Agent for this code' }, { status: 400 });
      }
    }

    // Check if email exists
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    const hashedPw = await hashPassword(password);

    // Create user — permanently linked to Sub-Agent via agentId + invitationCode
    const user = await prisma.user.create({
      data: {
        name: fullName,
        firstName: finalFirstName || null,
        lastName: finalLastName || null,
        email: email.toLowerCase(),
        password: hashedPw,
        role: 'USER',
        status: 'ACTIVE',
        phone: phone || null,
        mustChangePassword: false,
        agentId: agentId,
        invitationCode: codeUpper,
        referredBy: agentId,
      },
    });

    // Mark single-use USER codes as used; AGENT_CODE codes stay reusable
    if (code.role === 'USER') {
      await prisma.invitationCode.update({
        where: { code: codeUpper },
        data: {
          status: 'USED',
          usedBy: user.id,
          usedAt: new Date(),
        },
      });
    }

    // Create wallet with default balances
    await prisma.wallet.create({
      data: {
        userId: user.id,
        type: 'SPOT',
        totalEquity: 0,
        balances: {
          create: [
            { currency: 'USDT', amount: 0, frozen: 0 },
            { currency: 'BTC', amount: 0, frozen: 0 },
            { currency: 'ETH', amount: 0, frozen: 0 },
          ],
        },
      },
    });

    // Create referral record
    await prisma.referral.create({
      data: {
        referrerId: agentId,
        referredId: user.id,
        referralCode: codeUpper,
        level: 1,
        totalCommission: 0,
      },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      agentId: agentId,
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        phone: user.phone,
        agentId: agentId,
        invitationCode: codeUpper,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Register error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}