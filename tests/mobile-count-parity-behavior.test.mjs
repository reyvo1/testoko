import {parityDatabase} from './helpers/parity-database.mjs';
import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {PrismaClient} from '@prisma/client';
import {load} from './helpers/import-ts.mjs';
const database=parityDatabase('mobile');
const url=database.url;
const db=new PrismaClient({datasources:{db:{url}}});
const {MobileOpsService}=await load('apps/api/src/mobile-ops/mobile-ops.service.ts',{platform:'node',external:['@prisma/client','@nestjs/common']});
const service=new MobileOpsService(db);
const user={sub:'count-user',companyId:'count-company',branchId:'count-branch',roles:['WAREHOUSE'],permissions:['inventory.opname']};
let draft;
before(async()=>{
  database.prepare();
  await db.company.create({data:{id:user.companyId,name:'Synthetic TEST',slug:'count-test'}});
  for(const id of [user.branchId,'count-branch-other'])await db.branch.create({data:{id,companyId:user.companyId,code:id,name:'TEST branch'}});
  for(const [id,branchId] of [['count-warehouse',user.branchId],['count-warehouse-other','count-branch-other']])await db.warehouse.create({data:{id,branchId,code:id,name:'TEST warehouse'}});
  await db.user.create({data:{id:user.sub,branchId:user.branchId,email:'count-test@example.invalid',name:'Synthetic TEST operator',passwordHash:'synthetic-only'}});
  draft=await service.openDraft(user,{deviceId:'TEST device',warehouseId:'count-warehouse'});
});
after(async()=>{await database.close(db);});
test('concurrent opening resumes one draft, including a null location',async()=>{
  const rows=await Promise.all([service.openDraft(user,{deviceId:'TEST concurrent',warehouseId:'count-warehouse'}),service.openDraft(user,{deviceId:'TEST concurrent',warehouseId:'count-warehouse'})]);
  assert.equal(rows[0].id,rows[1].id);assert.equal(await db.mobileOpnameDraft.count({where:{deviceId:'TEST concurrent'}}),1);
});
test('same-key concurrent scan and reconnect retry add exactly once',async()=>{
  const payload={operationKey:'count-scan-operation',barcode:'TEST-BARCODE',quantity:4};
  const rows=await Promise.all([service.addScan(user,draft.id,payload),service.addScan(user,draft.id,payload)]);
  assert.deepEqual(rows[0],rows[1]);assert.deepEqual(await service.addScan(user,draft.id,payload),rows[0]);
  const saved=await service.getDraft(user,draft.id);assert.equal(saved.lines[0].quantity,4);assert.equal(await db.idempotencyReceipt.count({where:{resourceId:draft.id}}),1);
  await assert.rejects(()=>service.addScan(user,draft.id,{...payload,quantity:8}),/payload berbeda/);
});
test('different concurrent scan operations preserve both increments; empty keys and fractions fail',async()=>{
  await Promise.all([service.addScan(user,draft.id,{operationKey:'count-increment-one',barcode:'TEST-BARCODE',quantity:2}),service.addScan(user,draft.id,{operationKey:'count-increment-two',barcode:'TEST-BARCODE',quantity:3})]);
  assert.equal((await service.getDraft(user,draft.id)).lines[0].quantity,9);
  await assert.rejects(()=>service.addScan(user,draft.id,{operationKey:'',barcode:'TEST',quantity:1}),/Operation key/);
  await assert.rejects(()=>service.addScan(user,draft.id,{operationKey:'fraction-operation',barcode:'TEST',quantity:1.5}),/bilangan bulat/);
});
test('scan owner, branch and tenant are enforced; filters cannot widen branch visibility',async()=>{
  await assert.rejects(()=>service.addScan({...user,sub:'another-user'},draft.id,{operationKey:'unauthorized-scan',barcode:'TEST',quantity:1}),/pemilik/);
  await assert.rejects(()=>service.getDraft({...user,branchId:'count-branch-other'},draft.id),/cabang aktif/);
  await assert.rejects(()=>service.getDraft({...user,branchId:null},draft.id),/konteks cabang/);
  await assert.rejects(()=>service.listDrafts({...user,branchId:null}),/konteks cabang/);
  await assert.rejects(()=>service.getDraft({...user,companyId:'another-tenant'},draft.id),/tenant/);
  await assert.rejects(()=>service.openDraft(user,{deviceId:'foreign-branch',warehouseId:'count-warehouse-other'}),/cabang aktif/);
  const foreign=await service.openDraft({...user,branchId:'count-branch-other'},{deviceId:'foreign-device',warehouseId:'count-warehouse-other'});
  const page=await service.listDrafts(user,undefined,'count-warehouse-other');assert.equal(page.rows.length,0);assert.equal(page.counts.total,0);
  assert.ok(!(await service.listDrafts(user)).rows.some(row=>row.id===foreign.id));
});
test('terminal discard replays with the same reason and preserves immutable receipts without inventory effects',async()=>{
  const before=await db.inventoryMovement.count();const result=await service.discardDraft(user,draft.id,'Synthetic TEST cancelled');
  assert.equal((await service.discardDraft(user,draft.id,'Synthetic TEST cancelled')).id,result.id);
  await assert.rejects(()=>service.discardDraft(user,draft.id,'Changed reason'),/berbeda/);
  assert.equal(await db.auditLog.count({where:{entityId:draft.id,action:'MOBILE_OPNAME_DRAFT_DISCARDED'}}),1);
  assert.equal((await service.addScan(user,draft.id,{operationKey:'count-scan-operation',barcode:'TEST-BARCODE',quantity:4})).totalUnits,4);
  await assert.rejects(()=>service.addScan(user,draft.id,{operationKey:'new-terminal-scan',barcode:'TEST-BARCODE',quantity:1}),/DISCARDED/);
  assert.equal(await db.inventoryMovement.count(),before);
});
