import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, BreastMilkBagBalanceResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { calculateBagBalance, lastAmountPerBag } from '@/src/utils/breastMilkBags';

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const babyId = searchParams.get('babyId');
    const targetUnit = (searchParams.get('unit') || 'OZ').toUpperCase();

    if (!babyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby ID is required' }, { status: 400 });
    }

    const baby = await prisma.baby.findFirst({
      where: { id: babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }

    // The whole ledger, not a date window: the freezer is current state.
    const rows = await prisma.breastMilkBagLog.findMany({
      where: { babyId, familyId: userFamilyId, deletedAt: null },
      select: { bagCount: true, amountPerBag: true, unitAbbr: true, time: true, deletedAt: true },
    });

    const { bags, amount } = calculateBagBalance(rows, targetUnit);

    return NextResponse.json<ApiResponse<BreastMilkBagBalanceResponse>>({
      success: true,
      data: { bags, amount, unit: targetUnit, lastAmountPerBag: lastAmountPerBag(rows) },
    });
  } catch (error) {
    console.error('Error calculating breast milk bag balance:', error);
    return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Failed to calculate bag balance' }, { status: 500 });
  }
}

export const GET = withAuthContext(handleGet as any);
