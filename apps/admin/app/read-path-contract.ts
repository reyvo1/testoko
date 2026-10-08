import { isPersonnelSelfOnly } from '../../../packages/contracts/personnel-authority.cjs';
import { apiAccessMetadata, canAccessApiPath } from '../../../packages/contracts/src/api-access';
import type { AdminIdentity } from './navigation';

/**
 * A workspace is reachable by a menu gate, but its module bootstraps with a single
 * `Promise.all`. One endpoint that needs a permission the operator does not hold rejects the
 * whole batch, and the module renders `ErrorState` in place of the entire page — the operator
 * sees "Terjadi kendala" instead of a single missing panel.
 *
 * That is a real failure for legitimately-scoped roles. A CASHIER entering `commerce` passes the
 * `order|sale|shipment|payment` gate, but `operations.tsx` also calls `GET /returns/purchases`
 * (`purchase.return`) and `GET /master-data/warehouses` (`master_data.view`). Neither is in the
 * cashier's role, so the commerce workspace is blank for the person who uses it most.
 *
 * Fix: resolve each dependency independently and degrade to an empty slice when the operator
 * legitimately cannot read it. The controller keeps enforcing permissions; the UI simply stops
 * treating a forbidden optional panel as a fatal error for the whole page.
 */
const ROUTE_PERMISSION: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/hr\/leave-/, 'leave.view'],
  [/^\/hr\/overtime-/, 'overtime.view'],
  [/^\/hr\//, 'employee.view'],
  [/^\/attendance\//, 'attendance.view'],
  [/^\/payroll\/tax-rule-sets/, 'tax.view'],
  [/^\/payroll\//, 'payroll.view'],
  [/^\/platform\/business-rules/, 'automation.manage'],
  [/^\/platform\/automation-jobs/, 'automation.manage'],
  [/^\/reports\//, 'report.view'],
  [/^\/forecasts/, 'forecast.view'],
  [/^\/operator-insights/, 'assistant.use'],
  [/^\/operator-assistant\//, 'assistant.use'],
  [/^\/accounting-core\/tax-/, 'tax.view'],
  [/^\/accounting-core\//, 'finance.view'],
  [/^\/finance-operations\//, 'finance.view'],
  [/^\/returns\/sales/, 'sale.return'],
  [/^\/returns\/exchanges/, 'sale.return'],
  [/^\/returns\/purchases/, 'purchase.return'],
  [/^\/returns\//, 'return.view'],
  [/^\/master-data\//, 'master_data.view'],
  [/^\/advanced-inventory\//, 'inventory.view'],
  [/^\/operations-control\/policies/, 'operations.policy.view'],
  [/^\/operations-control\//, 'inspection.view'],
  [/^\/fleet\//, 'fleet.view'],
  [/^\/assets\//, 'asset.view'],
  [/^\/delivery\//, 'delivery.trip.manage'],
  [/^\/inventory\//, 'inventory.view'],
  [/^\/purchase\//, 'purchase.view'],
  [/^\/supplier\//, 'supplier.view'],
  [/^\/product\//, 'product.view'],
  [/^\/sale\//, 'sale.view'],
  [/^\/order\//, 'order.view'],
  [/^\/payment\//, 'payment.view'],
];

/** Permission the backend requires to read `path`, mirroring the controller @Permissions. */
export function readPermissionFor(path: string): string {
  const actual = apiAccessMetadata(path);
  if (actual?.permissions.length) return actual.permissions[0];
  const route = path.split('?')[0];
  for (const [pattern, permission] of ROUTE_PERMISSION) {
    if (pattern.test(route)) return permission;
  }
  return 'system.manage';
}

/** Controller metadata is generated and drift-checked against the TypeScript AST. */
export function canReadPath(identity: AdminIdentity | null, path: string): boolean {
  if (!identity) return false;
  const route = path.split('?')[0];
  if(isPersonnelSelfOnly(identity)&&route.startsWith('/payroll/'))return false;
  return canAccessApiPath(identity,path);
}

/**
 * Read a dependency that the current operator may not be allowed to read, returning `fallback`
 * instead of throwing. Pass this only for panels that are genuinely optional to the page — never
 * to hide a real failure, and never to widen what the controller accepts.
 *
 * `path` is the route the permission is derived from; `fetcher` receives it so the module's own
 * request helper stays the single place that knows about auth headers and transport. Modules that
 * already close over their helper can ignore the argument.
 */
export async function readOptional<T>(identity: AdminIdentity | null, path: string, fallback: T, fetcher: (path: string) => Promise<T>): Promise<T> {
  if (!canReadPath(identity, path)) return fallback;
  try {
    return await fetcher(path);
  } catch (err) {
    // A 403 here means the gate and the controller disagree, or the token expired mid-load.
    // Swallowing it would hide a real outage, so only an authorization failure degrades.
    if (err instanceof Error && /\b(403|401)\b|Forbidden|Unauthorized/.test(err.message)) return fallback;
    throw err;
  }
}

export function commerceOrderReadPath(identity: AdminIdentity | null) {
  return canReadPath(identity, '/orders') ? '/orders' : canReadPath(identity, '/orders/staff') ? '/orders/staff' : null;
}
export function warehouseDirectoryReadPath(identity: AdminIdentity | null) {
  return canReadPath(identity, '/inventory/warehouses') ? '/inventory/warehouses' : canReadPath(identity, '/master-data/warehouses') ? '/master-data/warehouses' : null;
}
