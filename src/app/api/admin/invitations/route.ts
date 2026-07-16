/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { authenticate } from '@/lib/rbac';

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/admin/invitations — list all invitation codes
export async function GET(request: NextRequest) {
  try {
    const { response } = authenticate(request, ['SUPER_ADMIN', 'SUB_AGENT']);
    if (response) return response;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const status = searchParams.get('status') || '';
    const role = searchParams.get('role') || '';
    const search = searchParams.get('search') || '';

    const where: any = {};
    if (status) where.status = status;
    if (role) where.role = role;
    if (search) {
      where.code = { contains: search.toUpperCase(), mode: 'insensitive' };
    }

    const [codes, total] = await Promise.all([
      prisma.invitationCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invitationCode.count({ where }),
    ]);

    const creatorIds = [...new Set(codes.map(c => c.createdBy).filter(Boolean))];
    const usedByIds = [...new Set(codes.map(c => c.usedBy).filter((x): x is string => x !== null))];

    const creators = creatorIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
        : [];
      const usedUsers = usedByIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: usedByIds } }, select: { id: true, name: true, email: true } })
        : [];

    const creatorMap = new Map(creators.map(u => [u.id, u]));
    const usedByMap = new Map(usedUsers.map(u => [u.id, u]));

    const enriched = codes.map(c => ({
      ...c,
      _id: c.id,
      createdByUser: creatorMap.get(c.createdBy) || null,
      usedByUser: c.usedBy ? usedByMap.get(c.usedBy) || null : null,
      isExpired: c.expiresAt && new Date(c.expiresAt) < new Date(),
    }));

    const [totalCodes, unusedCodes, usedCodes, disabledCodes, expiredCodes] = await Promise.all([
      prisma.invitationCode.count(),
      prisma.invitationCode.count({ where: { status: 'UNUSED' } }),
      prisma.invitationCode.count({ where: { status: 'USED' } }),
      prisma.invitationCode.count({ where: { status: 'DISABLED' } }),
      prisma.invitationCode.count({ where: { expiresAt: { lt: new Date() }, status: 'UNUSED' } }),
    ]);

    return NextResponse.json({
      codes: enriched,
      stats: { total: totalCodes, unused: unusedCodes, used: usedCodes, disabled: disabledCodes, expired: expiredCodes },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/invitations — create new invitation code(s)
export async function POST(request: NextRequest) {
  try {
    const { payload, response } = authenticate(request, ['SUPER_ADMIN']);
    if (response) return response;

    const body = await request.json();
    const { role, count, expiresInHours } = body;

    const codeRole = role || 'USER';
    if (!['AGENT_CODE', 'USER'].includes(codeRole)) {
      return NextResponse.json({ error: 'Role must be AGENT_CODE or USER' }, { status: 400 });
    }

    const codeCount = Math.min(50, Math.max(1, count || 1));

    let expiresAt: Date | undefined;
    if (expiresInHours && expiresInHours > 0) {
      expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);
    }

    // Get existing codes for collision check
    const existingCodes = new Set(
      (await prisma.invitationCode.findMany({ select: { code: true } })).map(c => c.code)
    );

    const created: any[] = [];
    for (let i = 0; i < codeCount; i++) {
      let newCode = generateCode();
      let attempts = 0;
      while (existingCodes.has(newCode) && attempts < 100) {
        newCode = generateCode();
        attempts++;
      }
      existingCodes.add(newCode);

      // For AGENT_CODE, createdBy should be the Sub-Agent ID (passed in body)
      // For USER codes, createdBy is the admin creating them
      const createdBy = codeRole === 'AGENT_CODE' && body.agentId ? body.agentId : payload.userId;

      // Verify agent exists if creating AGENT_CODE
      if (codeRole === 'AGENT_CODE' && body.agentId) {
        const agent = await prisma.user.findUnique({ where: { id: body.agentId } });
        if (!agent || agent.role !== 'SUB_AGENT') {
          return NextResponse.json({ error: 'Invalid Sub-Agent ID' }, { status: 400 });
        }
      }

      const code = await prisma.invitationCode.create({
        data: {
          code: newCode,
          role: codeRole,
          createdBy,
          status: 'UNUSED',
          ...(expiresAt ? { expiresAt } : {}),
        },
      });
      created.push({
        code: code.code,
        role: code.role,
        status: code.status,
        expiresAt: code.expiresAt,
      });
    }

    return NextResponse.json({
      message: `${created.length} invitation code(s) created successfully`,
      codes: created,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/admin/invitations — toggle invitation code status (enable/disable/reset)
export async function PUT(request: NextRequest) {
  try {
    const { response } = authenticate(request, ['SUPER_ADMIN']);
    if (response) return response;

    const body = await request.json();
    const { codeId, code, action } = body;

    if (!codeId && !code) {
      return NextResponse.json({ error: 'codeId or code is required' }, { status: 400 });
    }

    // Find the invitation code
    let invitation;
    if (codeId) {
      invitation = await prisma.invitationCode.findUnique({ where: { id: codeId } });
    } else {
      invitation = await prisma.invitationCode.findUnique({ where: { code: code.toUpperCase() } });
    }

    if (!invitation) {
      return NextResponse.json({ error: 'Invitation code not found' }, { status: 404 });
    }

    if (action === 'disable' || action === 'DISABLED') {
      invitation = await prisma.invitationCode.update({
        where: { id: invitation.id },
        data: { status: 'DISABLED' },
      });
    } else if (action === 'enable' || action === 'UNUSED') {
      if (invitation.status === 'USED') {
        return NextResponse.json({ error: 'Cannot re-enable a used code' }, { status: 400 });
      }
      invitation = await prisma.invitationCode.update({
        where: { id: invitation.id },
        data: { status: 'UNUSED' },
      });
    } else if (action === 'reset') {
      invitation = await prisma.invitationCode.update({
        where: { id: invitation.id },
        data: { status: 'UNUSED', usedBy: null, usedAt: null },
      });
    } else {
      if (invitation.status === 'USED') {
        return NextResponse.json({ error: 'Cannot toggle a used code' }, { status: 400 });
      }
      const newStatus = invitation.status === 'DISABLED' ? 'UNUSED' : 'DISABLED';
      invitation = await prisma.invitationCode.update({
        where: { id: invitation.id },
        data: { status: newStatus },
      });
    }

    return NextResponse.json({
      message: `Invitation code ${invitation.code} updated to ${invitation.status}`,
      code: invitation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}