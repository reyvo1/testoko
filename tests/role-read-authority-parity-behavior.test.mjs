import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { parityDatabase } from './helpers/parity-database.mjs';
import { load } from './helpers/import-ts.mjs';

const database = parityDatabase('role_read');
const db = new PrismaClient({ datasources: { db: { url: database.url } } });
const options = { platform: 'node', external: ['@prisma/client', '@nestjs/*'] };
const { FinanceOperationsService } = await load('apps/api/src/finance-operations/finance-operations.service.ts', options);
const { AccountingCoreService } = await load('apps/api/src/accounting-core/accounting-core.service.ts', options);
const { AssetsService } = await load('apps/api/src/assets/assets.service.ts', options);
const core = new AccountingCoreService(db);
const finance = new FinanceOperationsService(db, core);
const assets = new AssetsService(db, core);
const admin = { sub: 'role-read-admin', companyId: 'role-read-company-a', branchId: 'role-read-branch-a', roles: ['ADMIN'], permissions: ['finance.view', 'finance.create'] };
const warehouse = { ...admin, roles: ['WAREHOUSE'], permissions: ['asset.maintenance'] };
const date = new Date('2026-10-08T00:00:00Z');
const cursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');

before(async () => {
  database.prepare();
  for (const suffix of ['a', 'b']) await db.company.create({ data: { id: `role-read-company-${suffix}`, name: 'Synthetic TEST company', slug: `role-read-${suffix}` } });
  for (const [suffix, company] of [['a', 'a'], ['b', 'a'], ['c', 'b']]) {
    await db.branch.create({ data: { id: `role-read-branch-${suffix}`, companyId: `role-read-company-${company}`, code: suffix.toUpperCase(), name: 'Synthetic TEST branch' } });
    for (const [code, type] of [['1101', 'ASSET'], ['6101', 'EXPENSE']]) await db.account.create({ data: { branchId: `role-read-branch-${suffix}`, code, name: `Synthetic ${type}`, type } });
  }
  for (const id of [admin.sub, 'role-read-peer']) await db.user.create({ data: { id, branchId: admin.branchId, name: 'Synthetic TEST user', email: `${id}@example.invalid`, passwordHash: 'synthetic-only' } });
  for (const [id, companyId, branchId, createdById] of [
    ['own-a', admin.companyId, admin.branchId, admin.sub], ['own-b', admin.companyId, admin.branchId, admin.sub],
    ['peer', admin.companyId, admin.branchId, 'role-read-peer'], ['foreign-branch', admin.companyId, 'role-read-branch-b', admin.sub],
    ['foreign-company', 'role-read-company-b', 'role-read-branch-c', admin.sub],
  ]) await db.operationalFinanceTransaction.create({ data: { id, companyId, branchId, createdById, number: id, idempotencyKey: id, type: 'OPERATING_EXPENSE', transactionDate: date, description: 'Synthetic TEST draft', grossAmount: 17, netAmount: 17, debitAccountCode: '6101', creditAccountCode: '1101' } });
  for (const [id, companyId, branchId, code, status] of [
    ['asset-a', admin.companyId, admin.branchId, 'A', 'ACTIVE'], ['asset-b', admin.companyId, admin.branchId, 'B', 'DAMAGED'],
    ['asset-retired', admin.companyId, admin.branchId, 'C', 'DISPOSED'], ['asset-branch', admin.companyId, 'role-read-branch-b', 'D', 'ACTIVE'],
    ['asset-company', 'role-read-company-b', 'role-read-branch-c', 'E', 'ACTIVE'],
  ]) await db.asset.create({ data: { id, companyId, branchId, code, status, name: `Synthetic equipment ${code}`, categoryId: 'synthetic-category', assetType: 'EQUIPMENT', acquisitionCost: 1000, bookValue: 900, latitude: 1, longitude: 2, assignedEmployeeId: 'synthetic-private-person', locationName: 'Synthetic private location', metadata: { private: 'Synthetic TEST only' } } });
});
after(async () => { await database.close(db); });

test('Admin Finance pages contain only the authenticated creator in the active company and branch', async () => {
  const first = await finance.list(admin, undefined, undefined, '1');
  assert.equal(first.items.length, 1); assert.ok(first.pageInfo.nextCursor);
  const second = await finance.list(admin, undefined, undefined, '1', first.pageInfo.nextCursor);
  assert.deepEqual([...first.items, ...second.items].map(row => row.id).sort(), ['own-a', 'own-b']);
  assert.equal(second.pageInfo.nextCursor, null);
  assert.ok([...first.items, ...second.items].every(row => row.createdById === admin.sub));
  await assert.rejects(() => finance.list(admin, undefined, undefined, '25', undefined, 'role-read-company-b'), error => error.getStatus() === 403);
  await assert.rejects(() => finance.list(admin, undefined, undefined, '25', undefined, undefined, 'role-read-branch-b'), error => error.getStatus() === 403);
  await assert.rejects(() => finance.list(admin, undefined, undefined, '25', cursor({ transactionDate: 'invalid', id: 'own-a' })), /Cursor/);
});

test('existing Finance/Auditor and legitimate mixed roles preserve scoped peer visibility', async () => {
  for (const roles of [['FINANCE'], ['AUDITOR'], ['ADMIN', 'FINANCE']]) {
    const page = await finance.list({ ...admin, roles });
    assert.deepEqual(page.items.map(row => row.id).sort(), ['own-a', 'own-b', 'peer']);
  }
});

test('account selector projects only permitted metadata from the active tenant branch', async () => {
  const rows = await core.listAccounts(admin); assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['code', 'id', 'isActive', 'name', 'type']);
  await assert.rejects(() => core.listAccounts({ ...admin, branchId: undefined }), error => error.getStatus() === 403);
  assert.deepEqual(await core.listAccounts({ ...admin, branchId: 'role-read-branch-c' }), []);
});

test('Warehouse maintenance catalog is paginated/searchable and excludes tenant peers, retired assets and private/financial fields', async () => {
  const first = await assets.maintenanceCatalog(warehouse, '1');
  const second = await assets.maintenanceCatalog(warehouse, '1', first.pageInfo.nextCursor);
  assert.deepEqual([...first.items, ...second.items].map(row => row.id), ['asset-a', 'asset-b']);
  assert.equal(second.pageInfo.nextCursor, null);
  for (const row of [...first.items, ...second.items]) assert.deepEqual(Object.keys(row).sort(), ['assetType', 'code', 'id', 'name', 'status']);
  const search = await assets.maintenanceCatalog(warehouse, '25', undefined, 'equipment B');
  assert.deepEqual(search.items.map(row => row.id), ['asset-b']);
  assert.deepEqual((await assets.maintenanceCatalog({ ...warehouse, branchId: 'role-read-branch-c' })).items, []);
});

test('maintenance catalog rejects missing trusted scope, insufficient grants, malformed cursor/search and invalid page sizes', async () => {
  for (const actor of [{ ...warehouse, branchId: undefined }, { ...warehouse, permissions: [] }, { ...warehouse, roles: ['CASHIER'] }]) await assert.rejects(() => assets.maintenanceCatalog(actor), error => error.getStatus() === 403);
  await assert.rejects(() => assets.maintenanceCatalog(warehouse, '0'), /limit/);
  await assert.rejects(() => assets.maintenanceCatalog(warehouse, '25', cursor({ code: 'A', id: 3 })), /Cursor/);
  await assert.rejects(() => assets.maintenanceCatalog(warehouse, '25', undefined, ['A', 'B']), /Pencarian/);
});

test('Admin creates and reads its canonical idempotent draft without posting a journal', async () => {
  const input = { type: 'OPERATING_EXPENSE', amount: 17, debitAccountCode: '6101', creditAccountCode: '1101', description: 'Synthetic TEST Admin expense', requireApproval: false, idempotencyKey: 'role-read-admin-draft-retry' };
  const first = await finance.create(input, admin);
  const replay = await finance.create(input, admin);
  assert.equal(first.id, replay.id); assert.equal(first.status, 'DRAFT');
  assert.equal(await db.operationalFinanceTransaction.count({ where: { companyId: admin.companyId, idempotencyKey: input.idempotencyKey } }), 1);
  assert.ok((await finance.list(admin)).items.some(row => row.id === first.id));
  assert.equal(await db.journalEntry.count(), 0); assert.equal(await db.accountingEvent.count(), 0);
});
