import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../../utils/auth';
import { checkWritePermission } from '../../utils/writeProtection';
import { bridgeFetch, isAdmin, loadConfig, parseJson, saveConfig } from '../utils';

interface PairResult {
  paired: boolean;
  bridgeIp: string;
}

async function handlePost(req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<PairResult>>> {
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
  const bridgeIp = typeof body?.bridgeIp === 'string' ? body.bridgeIp.trim() : '';
  if (!/^[\d.]+$|^[a-zA-Z0-9.-]+$/.test(bridgeIp)) {
    return NextResponse.json({ success: false, error: 'Invalid bridgeIp' }, { status: 400 });
  }

  // The Hue bridge expects POST /api with {"devicetype":"<app>#<instance>"} after
  // the user presses the physical link button. It returns either
  // [{"success":{"username":"..."}}] or [{"error":{"type":101,...}}].
  let res;
  try {
    res = await bridgeFetch(bridgeIp, '/api', {
      method: 'POST',
      body: { devicetype: 'sprout-track#nursery' },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: `Bridge unreachable: ${(err as Error).message}` }, { status: 502 });
  }

  type PairEntry = { success?: { username: string }; error?: { type: number; description: string } };
  const data = parseJson<PairEntry[]>(res);
  if (!Array.isArray(data) || data.length === 0) {
    return NextResponse.json({ success: false, error: 'Unexpected bridge response' }, { status: 502 });
  }

  const entry = data[0];
  if (entry.error) {
    // Type 101 = link button not pressed
    return NextResponse.json(
      { success: false, error: entry.error.description || 'Pairing failed' },
      { status: entry.error.type === 101 ? 428 : 502 }
    );
  }
  const appKey = entry.success?.username;
  if (!appKey) {
    return NextResponse.json({ success: false, error: 'Bridge did not return an app key' }, { status: 502 });
  }

  const existing = await loadConfig(familyId);
  await saveConfig(familyId, { ...existing, bridgeIp, appKey });
  return NextResponse.json({ success: true, data: { paired: true, bridgeIp } });
}

export const POST = withAuthContext(handlePost);
