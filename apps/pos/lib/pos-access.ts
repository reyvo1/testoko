import { canAccessApiPath } from '../../../packages/contracts/src/api-access';
import type { PosWorkspace } from '../app/pos-shell';

export function posIdentity(token: string | null) {
  try {
    if (!token) return null;
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!Array.isArray(claims.roles) || !Array.isArray(claims.permissions)) return null;
    return { roles: claims.roles as string[], permissions: claims.permissions as string[] };
  } catch { return null; }
}
export function posWorkspaces(token: string | null): PosWorkspace[] {
  const identity = posIdentity(token);
  const can = (path: string, method = 'GET') => canAccessApiPath(identity, path, method);
  const sale = can('/sales', 'POST') && can('/sales/offline/config') && can('/inventory/warehouses');
  return [
    ...(sale ? ['SALE' as const] : []),
    ...(sale && can('/sales/shifts/current') ? ['SHIFT' as const] : []),
    ...(can('/sales') && can('/returns/sales') ? ['RETURNS' as const] : []),
    ...(can('/digital-services/status') ? ['PPOB' as const] : []),
    ...(sale && can('/sales/offline/replay', 'POST') ? ['SYNC' as const] : []),
  ];
}
