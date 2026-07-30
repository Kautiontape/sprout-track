import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, PottyLogCreate, PottyLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';
import { notifyActivityCreated, resetTimerNotificationState } from '@/src/lib/notifications/activityHook';

const format = (log: any): PottyLogResponse => ({
  ...log,
  time: formatForResponse(log.time) || '',
  createdAt: formatForResponse(log.createdAt) || '',
  updatedAt: formatForResponse(log.updatedAt) || '',
  deletedAt: formatForResponse(log.deletedAt),
});

async function handlePost(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const body: PottyLogCreate = await req.json();

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    const pottyLog = await prisma.pottyLog.create({
      data: {
        ...body,
        time: toUTC(body.time),
        caretakerId: caretakerId,
        familyId: userFamilyId,
      },
    });

    // A potty catch resets the diaper timer — see src/lib/elimination.ts.
    notifyActivityCreated(pottyLog.babyId, 'potty', { accountId: authContext.accountId, caretakerId: authContext.caretakerId }, { type: body.type }).catch(console.error);
    resetTimerNotificationState(pottyLog.babyId, 'diaper').catch(console.error);

    return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
  } catch (error) {
    console.error('Error creating potty log:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse>>(
      { success: false, error: 'Failed to create potty log' },
      { status: 500 }
    );
  }
}

async function handlePut(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body: Partial<PottyLogCreate> = await req.json();

    if (!id) {
      return NextResponse.json<ApiResponse<PottyLogResponse>>(
        { success: false, error: 'Potty log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.pottyLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<PottyLogResponse>>(
        { success: false, error: 'Potty log not found or access denied' },
        { status: 404 }
      );
    }

    const data: any = { ...body };
    if (body.time) {
      data.time = toUTC(body.time);
    }
    delete data.babyId;
    delete data.familyId;
    delete data.caretakerId;

    const pottyLog = await prisma.pottyLog.update({ where: { id }, data });

    return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
  } catch (error) {
    console.error('Error updating potty log:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse>>(
      { success: false, error: 'Failed to update potty log' },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const babyId = searchParams.get('babyId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const oldest = searchParams.get('oldest') === 'true';

    if (id) {
      const pottyLog = await prisma.pottyLog.findFirst({
        where: { id, familyId: userFamilyId },
      });

      if (!pottyLog) {
        return NextResponse.json<ApiResponse<PottyLogResponse>>(
          { success: false, error: 'Potty log not found or access denied' },
          { status: 404 }
        );
      }

      return NextResponse.json<ApiResponse<PottyLogResponse>>({ success: true, data: format(pottyLog) });
    }

    // EC anchor lookup: the single earliest non-deleted potty log ever
    // logged, used by Reports to clamp day-based denominators. Not
    // month/date-bounded — the anchor is always the all-time first catch.
    if (oldest) {
      const oldestLog = await prisma.pottyLog.findFirst({
        where: {
          familyId: userFamilyId,
          ...(babyId && { babyId }),
          deletedAt: null,
        },
        orderBy: { time: 'asc' },
      });

      return NextResponse.json<ApiResponse<PottyLogResponse | null>>({
        success: true,
        data: oldestLog ? format(oldestLog) : null,
      });
    }

    const pottyLogs = await prisma.pottyLog.findMany({
      where: {
        familyId: userFamilyId,
        ...(babyId && { babyId }),
        ...(startDate && endDate && {
          time: { gte: toUTC(startDate), lte: toUTC(endDate) },
        }),
      },
      orderBy: { time: 'desc' },
    });

    return NextResponse.json<ApiResponse<PottyLogResponse[]>>({
      success: true,
      data: pottyLogs.map(format),
    });
  } catch (error) {
    console.error('Error fetching potty logs:', error);
    return NextResponse.json<ApiResponse<PottyLogResponse[]>>(
      { success: false, error: 'Failed to fetch potty logs' },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest, authContext: AuthResult) {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Potty log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.pottyLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Potty log not found or access denied' },
        { status: 404 }
      );
    }

    await prisma.pottyLog.delete({ where: { id } });

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error deleting potty log:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to delete potty log' },
      { status: 500 }
    );
  }
}

// Apply authentication middleware to all handlers
// Use type assertions to handle the multiple return types
export const GET = withAuthContext(handleGet as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const POST = withAuthContext(handlePost as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const PUT = withAuthContext(handlePut as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const DELETE = withAuthContext(handleDelete as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
