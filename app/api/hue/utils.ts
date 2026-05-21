import { request as httpsRequest } from 'node:https';
import prisma from '../db';

export interface HueButton {
  id: string;
  label: string;
  sceneId: string;
  order: number;
}

export interface HueConfig {
  bridgeIp?: string;
  appKey?: string;
  buttons: HueButton[];
}

export interface PublicHueConfig {
  paired: boolean;
  bridgeIp?: string;
  buttons: HueButton[];
}

export interface BridgeResponse {
  ok: boolean;
  status: number;
  body: string;
}

export async function loadConfig(familyId: string): Promise<HueConfig> {
  const settings = await prisma.settings.findFirst({ where: { familyId } });
  if (!settings?.hueConfig) return { buttons: [] };
  try {
    const parsed = JSON.parse(settings.hueConfig) as HueConfig;
    return { ...parsed, buttons: parsed.buttons ?? [] };
  } catch {
    return { buttons: [] };
  }
}

export async function saveConfig(familyId: string, config: HueConfig): Promise<void> {
  await prisma.settings.updateMany({
    where: { familyId },
    data: { hueConfig: JSON.stringify(config) },
  });
}

export function toPublic(config: HueConfig): PublicHueConfig {
  return {
    paired: Boolean(config.bridgeIp && config.appKey),
    bridgeIp: config.bridgeIp,
    buttons: [...config.buttons].sort((a, b) => a.order - b.order),
  };
}

// Hue Bridges serve the v2 API over HTTPS with a self-signed certificate signed
// by their own internal CA. The bridge is on-LAN, so we skip cert verification
// for these requests only (per-request, not process-wide). We use Node's
// built-in https module rather than fetch because Node's fetch doesn't accept
// a per-call TLS-agent override.
export async function bridgeFetch(
  bridgeIp: string,
  path: string,
  init: { method?: string; appKey?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<BridgeResponse> {
  const payload = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  const headers: Record<string, string> = {};
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }
  if (init.appKey) headers['hue-application-key'] = init.appKey;

  return new Promise<BridgeResponse>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: bridgeIp,
        port: 443,
        path,
        method: init.method ?? 'GET',
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(init.timeoutMs ?? 5000, () => {
      req.destroy(new Error('Bridge request timed out'));
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export function parseJson<T>(res: BridgeResponse): T | null {
  try {
    return JSON.parse(res.body) as T;
  } catch {
    return null;
  }
}

export function isAdmin(authContext: {
  caretakerRole?: string;
  isSysAdmin?: boolean;
}): boolean {
  return (
    authContext.caretakerRole === 'ADMIN' ||
    authContext.caretakerRole === 'OWNER' ||
    !!authContext.isSysAdmin
  );
}
