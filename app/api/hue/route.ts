import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../utils/auth';
import { checkWritePermission } from '../utils/writeProtection';
import { HueButton, loadConfig, saveConfig, toPublic, isAdmin, PublicHueConfig } from './utils';

async function handleGet(_req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<PublicHueConfig>>> {
  const { familyId } = authContext;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'No family' }, { status: 403 });
  }
  const config = await loadConfig(familyId);
  return NextResponse.json({ success: true, data: toPublic(config) });
}

async function handlePut(req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<PublicHueConfig>>> {
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) return writeCheck.response!;

  const { familyId } = authContext;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'No family' }, { status: 403 });
  }
  if (!isAdmin(authContext)) {
    return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rawButtons: unknown = body?.buttons;
  if (!Array.isArray(rawButtons)) {
    return NextResponse.json({ success: false, error: 'buttons must be an array' }, { status: 400 });
  }

  const buttons: HueButton[] = [];
  for (let i = 0; i < rawButtons.length; i++) {
    const b = rawButtons[i] as Partial<HueButton>;
    if (!b || typeof b.sceneId !== 'string' || typeof b.label !== 'string') {
      return NextResponse.json({ success: false, error: `Invalid button at index ${i}` }, { status: 400 });
    }
    buttons.push({
      id: typeof b.id === 'string' && b.id ? b.id : `btn_${Date.now()}_${i}`,
      label: b.label.trim().slice(0, 40) || 'Scene',
      sceneId: b.sceneId,
      order: typeof b.order === 'number' ? b.order : i,
    });
  }

  const existing = await loadConfig(familyId);
  const next = { ...existing, buttons };
  await saveConfig(familyId, next);
  return NextResponse.json({ success: true, data: toPublic(next) });
}

export const GET = withAuthContext(handleGet);
export const PUT = withAuthContext(handlePut);
