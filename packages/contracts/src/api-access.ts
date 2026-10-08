import policy from '../api-access-policy.json';

type Identity = { roles: string[]; permissions: string[] };
// Matches the actual controller decorators; this never replaces server authorization,
// tenant/data ownership, customer sessions, feature rollout or device/provider guards.
export function apiAccessMetadata(path: string, method = 'GET') {
  const segments = path.split('?')[0].replace(/\/+$/, '').split('/');
  return policy.routes.find(route => route.method === method.toUpperCase()
    && route.path.split('/').length === segments.length
    && route.path.split('/').every((segment, index) => segment.startsWith(':') || segment === segments[index]));
}
export function canAccessApiPath(identity: Identity | null, path: string, method = 'GET') {
  if (!identity) return false;
  const metadata = apiAccessMetadata(path, method);
  if (!metadata) return false;
  if (metadata.roles.length && !metadata.roles.some(role => identity.roles.includes(role))) return false;
  return identity.roles.includes('SUPER_ADMIN') || metadata.permissions.every(permission => identity.permissions.includes(permission));
}
