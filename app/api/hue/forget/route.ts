import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../../utils/auth';
import { checkWritePermission } from '../../utils/writeProtection';
import prisma from '../../db';
import { isAdmin } from '../utils';

async function handlePost(_req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<{ forgotten: true }>>> {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) return writeCheck.response!;

  const { familyId } = authContext;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'No family' }, { status: 403 });
  }
  if (!isAdmin(authContext)) {
    return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
  }

  await prisma.settings.updateMany({
    where: { familyId },
    data: { hueConfig: null },
  });

  return NextResponse.json({ success: true, data: { forgotten: true } });
}

export const POST = withAuthContext(handlePost);
