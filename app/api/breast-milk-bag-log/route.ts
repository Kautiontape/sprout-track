import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, BreastMilkBagLogCreate, BreastMilkBagLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';

const format = (log: any): BreastMilkBagLogResponse => ({
  ...log,
  time: formatForResponse(log.time) || '',
  createdAt: formatForResponse(log.createdAt) || '',
  updatedAt: formatForResponse(log.updatedAt) || '',
  deletedAt: formatForResponse(log.deletedAt),
});

/**
 * A zero bag count records nothing, and a non-positive per-bag amount would make
 * the derived volume meaningless. Reject both rather than storing a row that no
 * downstream reader can interpret.
 */
function validate(body: Partial<BreastMilkBagLogCreate>, requireAll: boolean): string | null {
  if (requireAll && (body.bagCount === undefined || body.amountPerBag === undefined)) {
    return 'Bag count and amount per bag are required';
  }
  if (body.bagCount !== undefined) {
    if (!Number.isInteger(body.bagCount) || body.bagCount === 0) {
      return 'Bag count must be a non-zero whole number';
    }
  }
  if (body.amountPerBag !== undefined) {
    if (typeof body.amountPerBag !== 'number' || !(body.amountPerBag > 0)) {
      return 'Amount per bag must be greater than zero';
    }
  }
  return null;
}

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

    const body: BreastMilkBagLogCreate = await req.json();

    const validationError = validate(body, true);
    if (validationError) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: validationError }, { status: 400 });
    }

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    // Fields are named explicitly rather than spread from `body`: TS types are
    // erased at runtime, so a spread would let a client set `id`, `deletedAt`,
    // or `createdAt`. Mirrors app/api/breast-milk-adjustment/route.ts.
    const bagLog = await prisma.breastMilkBagLog.create({
      data: {
        babyId: body.babyId,
        time: toUTC(body.time),
        bagCount: body.bagCount,
        amountPerBag: body.amountPerBag,
        unitAbbr: body.unitAbbr,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        caretakerId: caretakerId,
        familyId: userFamilyId,
      },
    });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
  } catch (error) {
    console.error('Error creating breast milk bag log:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
      { success: false, error: 'Failed to create breast milk bag log' },
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
    const body: Partial<BreastMilkBagLogCreate> = await req.json();

    if (!id) {
      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
        { success: false, error: 'Breast milk bag log ID is required' },
        { status: 400 }
      );
    }

    const validationError = validate(body, false);
    if (validationError) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: validationError }, { status: 400 });
    }

    const existing = await prisma.breastMilkBagLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
        { success: false, error: 'Breast milk bag log not found or access denied' },
        { status: 404 }
      );
    }

    // Built field-by-field rather than spread, so unlisted columns (`id`,
    // `deletedAt`, `createdAt`) can't be set by a client, and `babyId`/
    // `familyId`/`caretakerId` can't be used to re-parent the row.
    const data: any = {};
    if (body.time !== undefined) data.time = toUTC(body.time);
    if (body.bagCount !== undefined) data.bagCount = body.bagCount;
    if (body.amountPerBag !== undefined) data.amountPerBag = body.amountPerBag;
    if (body.unitAbbr !== undefined) data.unitAbbr = body.unitAbbr;
    if (body.reason !== undefined) data.reason = body.reason;
    if (body.notes !== undefined) data.notes = body.notes;

    const bagLog = await prisma.breastMilkBagLog.update({ where: { id }, data });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
  } catch (error) {
    console.error('Error updating breast milk bag log:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
      { success: false, error: 'Failed to update breast milk bag log' },
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

    if (id) {
      const bagLog = await prisma.breastMilkBagLog.findFirst({
        where: { id, familyId: userFamilyId },
      });

      if (!bagLog) {
        return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>(
          { success: false, error: 'Breast milk bag log not found or access denied' },
          { status: 404 }
        );
      }

      return NextResponse.json<ApiResponse<BreastMilkBagLogResponse>>({ success: true, data: format(bagLog) });
    }

    const bagLogs = await prisma.breastMilkBagLog.findMany({
      where: {
        familyId: userFamilyId,
        ...(babyId && { babyId }),
        ...(startDate && endDate && {
          time: { gte: toUTC(startDate), lte: toUTC(endDate) },
        }),
      },
      orderBy: { time: 'desc' },
    });

    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse[]>>({
      success: true,
      data: bagLogs.map(format),
    });
  } catch (error) {
    console.error('Error fetching breast milk bag logs:', error);
    return NextResponse.json<ApiResponse<BreastMilkBagLogResponse[]>>(
      { success: false, error: 'Failed to fetch breast milk bag logs' },
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
        { success: false, error: 'Breast milk bag log ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.breastMilkBagLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existing) {
      return NextResponse.json<ApiResponse<void>>(
        { success: false, error: 'Breast milk bag log not found or access denied' },
        { status: 404 }
      );
    }

    await prisma.breastMilkBagLog.delete({ where: { id } });

    return NextResponse.json<ApiResponse<void>>({ success: true });
  } catch (error) {
    console.error('Error deleting breast milk bag log:', error);
    return NextResponse.json<ApiResponse<void>>(
      { success: false, error: 'Failed to delete breast milk bag log' },
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
