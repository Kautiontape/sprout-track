import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../../utils/auth';
import { bridgeFetch, loadConfig } from '../utils';

async function handlePost(req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<{ activated: true }>>> {
  const { familyId } = authContext;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'No family' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const buttonId = typeof body?.buttonId === 'string' ? body.buttonId : '';
  const sceneIdOverride = typeof body?.sceneId === 'string' ? body.sceneId : '';
  if (!buttonId && !sceneIdOverride) {
    return NextResponse.json({ success: false, error: 'buttonId or sceneId required' }, { status: 400 });
  }

  const config = await loadConfig(familyId);
  if (!config.bridgeIp || !config.appKey) {
    return NextResponse.json({ success: false, error: 'Bridge not paired' }, { status: 409 });
  }

  let sceneId = sceneIdOverride;
  if (!sceneId) {
    const btn = config.buttons.find((b) => b.id === buttonId);
    if (!btn) {
      return NextResponse.json({ success: false, error: 'Button not found' }, { status: 404 });
    }
    sceneId = btn.sceneId;
  }

  try {
    const res = await bridgeFetch(config.bridgeIp, `/clip/v2/resource/scene/${encodeURIComponent(sceneId)}`, {
      method: 'PUT',
      appKey: config.appKey,
      body: { recall: { action: 'active' } },
    });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Bridge error (${res.status}) ${res.body}`.trim() }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: { activated: true } });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 502 });
  }
}

export const POST = withAuthContext(handlePost);
