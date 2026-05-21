import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../../utils/auth';
import { bridgeFetch, isAdmin, loadConfig, parseJson } from '../utils';

interface SceneListItem {
  id: string;
  name: string;
  room?: string;
}

interface HueResource {
  id: string;
  type?: string;
  metadata?: { name?: string };
  group?: { rid: string; rtype: string };
}

async function handleGet(_req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<SceneListItem[]>>> {
  const { familyId } = authContext;
  if (!familyId) {
    return NextResponse.json({ success: false, error: 'No family' }, { status: 403 });
  }
  if (!isAdmin(authContext)) {
    return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
  }

  const config = await loadConfig(familyId);
  if (!config.bridgeIp || !config.appKey) {
    return NextResponse.json({ success: false, error: 'Bridge not paired' }, { status: 409 });
  }

  try {
    const [sceneRes, roomRes, zoneRes] = await Promise.all([
      bridgeFetch(config.bridgeIp, '/clip/v2/resource/scene', { appKey: config.appKey }),
      bridgeFetch(config.bridgeIp, '/clip/v2/resource/room', { appKey: config.appKey }),
      bridgeFetch(config.bridgeIp, '/clip/v2/resource/zone', { appKey: config.appKey }),
    ]);

    if (!sceneRes.ok) {
      return NextResponse.json({ success: false, error: `Bridge error (${sceneRes.status})` }, { status: 502 });
    }

    const groups = new Map<string, string>();
    for (const res of [roomRes, zoneRes]) {
      if (!res.ok) continue;
      const json = parseJson<{ data?: HueResource[] }>(res);
      for (const g of json?.data ?? []) {
        if (g.id && g.metadata?.name) groups.set(g.id, g.metadata.name);
      }
    }

    const sceneJson = parseJson<{ data?: HueResource[] }>(sceneRes);
    const scenes: SceneListItem[] = (sceneJson?.data ?? []).map((s) => ({
      id: s.id,
      name: s.metadata?.name ?? '(unnamed)',
      room: s.group ? groups.get(s.group.rid) : undefined,
    }));

    // Group scenes by room, then sort within each group
    scenes.sort((a, b) => {
      const ra = a.room ?? '';
      const rb = b.room ?? '';
      if (ra !== rb) return ra.localeCompare(rb);
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ success: true, data: scenes });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 502 });
  }
}

export const GET = withAuthContext(handleGet);
