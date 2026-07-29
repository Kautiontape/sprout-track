import { NextRequest, NextResponse } from 'next/server';
import prisma from '../db';
import { ApiResponse, PottyLocationSettings } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';

async function handleGet(req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<PottyLocationSettings>>> {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<PottyLocationSettings>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const settings = await prisma.settings.findFirst({
      where: { familyId: userFamilyId },
      orderBy: { updatedAt: 'desc' },
    });

    const defaultResult: PottyLocationSettings = { hiddenLocations: [] };

    if (!settings) {
      return NextResponse.json({ success: true, data: defaultResult });
    }

    const settingsWithField = settings as unknown as (typeof settings & { pottyLocationSettings?: string });

    if (!settingsWithField.pottyLocationSettings) {
      return NextResponse.json({ success: true, data: defaultResult });
    }

    try {
      const parsed = JSON.parse(settingsWithField.pottyLocationSettings) as PottyLocationSettings;
      return NextResponse.json({ success: true, data: parsed });
    } catch {
      return NextResponse.json({ success: true, data: defaultResult });
    }
  } catch (error) {
    console.error('Error retrieving potty location settings:', error);
    return NextResponse.json({ success: true, data: { hiddenLocations: [] } });
  }
}

async function handlePost(req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<PottyLocationSettings>>> {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<PottyLocationSettings>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const body = await req.json();
    const { hiddenLocations } = body as PottyLocationSettings;

    if (!Array.isArray(hiddenLocations)) {
      return NextResponse.json(
        { success: false, error: 'Invalid format: hiddenLocations must be an array' },
        { status: 400 }
      );
    }

    let settings = await prisma.settings.findFirst({
      where: { familyId: userFamilyId },
      orderBy: { updatedAt: 'desc' },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          familyId: userFamilyId,
          familyName: 'My Family',
          securityPin: '111222',
          defaultBottleUnit: 'OZ',
          defaultSolidsUnit: 'TBSP',
          defaultHeightUnit: 'IN',
          defaultWeightUnit: 'LB',
          defaultTempUnit: 'F',
          pottyLocationSettings: JSON.stringify({ hiddenLocations }),
        } as any,
      });
    } else {
      await prisma.settings.update({
        where: { id: settings.id },
        data: {
          ...(({ pottyLocationSettings: JSON.stringify({ hiddenLocations }) }) as any),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { hiddenLocations },
    });
  } catch (error) {
    console.error('Error saving potty location settings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save potty location settings' },
      { status: 500 }
    );
  }
}

export const GET = withAuthContext(handleGet);
export const POST = withAuthContext(handlePost);
