import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext, AuthResult, ApiResponse } from '../../utils/auth';
import { isAdmin } from '../utils';

interface DiscoveredBridge {
  id: string;
  internalipaddress: string;
}

async function handlePost(_req: NextRequest, authContext: AuthResult): Promise<NextResponse<ApiResponse<DiscoveredBridge[]>>> {
  if (!isAdmin(authContext)) {
    return NextResponse.json({ success: false, error: 'Admin required' }, { status: 403 });
  }

  try {
    const res = await fetch('https://discovery.meethue.com/', { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Discovery failed (${res.status})` }, { status: 502 });
    }
    const data = (await res.json()) as DiscoveredBridge[];
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 502 });
  }
}

export const POST = withAuthContext(handlePost);
