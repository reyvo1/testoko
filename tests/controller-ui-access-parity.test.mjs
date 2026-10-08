import assert from 'node:assert/strict';
import test from 'node:test';
import { analysis } from './helpers/mutation-payload-parity.mjs';
import { load } from './helpers/import-ts.mjs';

const { canAccessApiPath, apiAccessMetadata } = await load('packages/contracts/src/api-access.ts');
const { RolesGuard } = await load('apps/api/src/auth/roles.guard.ts', { external: ['@nestjs/common','@nestjs/core'] });
const { PermissionsGuard } = await load('apps/api/src/auth/permissions.guard.ts', { external: ['@nestjs/common','@nestjs/core'] });
const roles = ['SUPER_ADMIN','OWNER','ADMIN','CASHIER','WAREHOUSE','PURCHASING','FINANCE','AUDITOR','HR','PAYROLL','MANAGER','EMPLOYEE'];
const allPermissions = [...new Set(analysis.routes.flatMap(route => route.perms))];

test('UI controller access matches the actual Nest role and permission guards for every operation and role', () => {
  assert.equal(analysis.routes.length, 554);
  let cases = 0;
  for (const route of analysis.routes) {
    const path = route.rawPath.replace(/:[^/]+/g, '_test_identity_');
    const metadata = apiAccessMetadata(path, route.method);
    assert.equal(metadata?.path, route.rawPath, `${route.method} ${route.rawPath}: static/dynamic route specificity`);
    assert.deepEqual(metadata.roles, route.roles);
    assert.deepEqual(metadata.permissions, route.perms);
    const reflector = { getAllAndOverride: key => key === 'roles' ? route.roles : route.perms };
    const roleGuard = new RolesGuard(reflector);
    const permissionGuard = new PermissionsGuard(reflector);
    for (const role of roles) for (const permissions of [allPermissions, []]) {
      const identity = { roles: [role], permissions };
      const context = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => ({ user: identity }) }) };
      let allowed;
      try { allowed = roleGuard.canActivate(context) && permissionGuard.canActivate(context); }
      catch { allowed = false; }
      assert.equal(canAccessApiPath(identity,path,route.method), allowed, `${role} ${route.method} ${path}`);
      cases++;
    }
  }
  assert.equal(cases, 13296);
});

test('restricted role reads/actions and unknown operations stay closed while permitted commerce remains accessible', () => {
  const cashier = { roles:['CASHIER'], permissions:allPermissions };
  const admin = { roles:['ADMIN'], permissions:allPermissions };
  assert.equal(canAccessApiPath(cashier,'/orders/staff'),true);
  assert.equal(canAccessApiPath(cashier,'/orders'),false);
  assert.equal(canAccessApiPath(cashier,'/advanced-inventory/stock-transfers'),false);
  assert.equal(canAccessApiPath(cashier,'/master-data/customers','POST'),true);
  assert.equal(canAccessApiPath(cashier,'/master-data/customers/_','PATCH'),false);
  assert.equal(canAccessApiPath(admin,'/accounting-core/tax-codes'),false);
  assert.equal(canAccessApiPath(admin,'/finance/fiscal-periods'),true);
  assert.equal(canAccessApiPath(admin,'/finance-operations'),true);
  assert.equal(canAccessApiPath(admin,'/accounting-core/accounts'),true);
  for (const action of ['approve','post','cancel','reject']) assert.equal(canAccessApiPath(admin,`/finance-operations/_/${action}`,'POST'),false);
  const warehouse = { roles:['WAREHOUSE'], permissions:allPermissions };
  assert.equal(canAccessApiPath(warehouse,'/assets/maintenance-catalog'),true);
  assert.equal(canAccessApiPath(warehouse,'/assets'),false);
  assert.equal(canAccessApiPath({roles:['SUPER_ADMIN'],permissions:[]},'/unregistered/operation'),false);
  assert.equal(canAccessApiPath(null,'/products'),false);
});

const { posWorkspaces } = await load('apps/pos/lib/pos-access.ts');
test('POS role navigation retains cashier operations and isolates permitted read-only PPOB without cashier bootstrap', () => {
  const token = role => `x.${Buffer.from(JSON.stringify({roles:[role],permissions:allPermissions})).toString('base64url')}.x`;
  assert.deepEqual(posWorkspaces(token('CASHIER')), ['SALE','SHIFT','RETURNS','PPOB','SYNC']);
  for (const role of ['AUDITOR','MANAGER','HR','PAYROLL','EMPLOYEE']) assert.deepEqual(posWorkspaces(token(role)), ['PPOB']);
  assert.deepEqual(posWorkspaces(null), []);
  assert.deepEqual(posWorkspaces('invalid'), []);
});

const { commerceOrderReadPath, warehouseDirectoryReadPath } = await load('apps/admin/app/read-path-contract.ts');
const { activeAssignedDrivers } = await load('apps/admin/app/modules/delivery-drivers.ts');
test('dependent commerce and warehouse directories choose only a permitted canonical read model', () => {
  assert.equal(commerceOrderReadPath({roles:['CASHIER'],permissions:['sale.create']}), '/orders/staff');
  assert.equal(commerceOrderReadPath({roles:['AUDITOR'],permissions:allPermissions}), null);
  assert.equal(commerceOrderReadPath({roles:['MANAGER'],permissions:allPermissions}), null);
  assert.equal(warehouseDirectoryReadPath({roles:['MANAGER'],permissions:['master_data.view','manufacturing.manage']}), '/master-data/warehouses');
  assert.equal(warehouseDirectoryReadPath({roles:['AUDITOR'],permissions:['manufacturing.view']}), null);
});
test('warehouse driver choices include active assigned drivers, without requiring an HR directory', () => {
  const employee={id:'driver',employeeNumber:'DRIVER',fullName:'Synthetic driver',isActive:true};
  const now=Date.parse('2026-10-08T00:00:00Z');
  const active={effectiveFrom:'2026-10-01T00:00:00Z',employee};
  assert.deepEqual(activeAssignedDrivers([active,active,{...active,effectiveTo:'2026-10-07T00:00:00Z'},{...active,effectiveFrom:'2026-10-09T00:00:00Z'},{...active,employee:{...employee,id:'inactive',isActive:false}}], now), [employee]);
  assert.deepEqual(activeAssignedDrivers([{...active,effectiveFrom:'invalid'},{...active,effectiveTo:'invalid'}], now), []);
});
