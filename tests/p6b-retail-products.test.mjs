import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';

const root = new URL('../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 't360-p6b-'));
const url = `file:${path.join(dir, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const opts = { platform: 'node', external: ['@prisma/client', '@nestjs/microservices', '@nestjs/websockets', '@nestjs/websockets/socket-module'] };
const { decodeWeightBarcode, normalizeRetailPolicy } = await load('apps/api/src/common/retail-policy.ts');
const { ProductsService } = await load('apps/api/src/products/products.service.ts', opts);
const { SalesService } = await load('apps/api/src/sales/sales.service.ts', opts);
const { ManufacturingService } = await load('apps/api/src/manufacturing/manufacturing.service.ts', opts);
const { OrdersService } = await load('apps/api/src/orders/orders.service.ts', opts);
const { ReturnsService } = await load('apps/api/src/returns/returns.service.ts', opts);
const { AccountingCoreService } = await load('apps/api/src/accounting-core/accounting-core.service.ts', opts);
const { OperationsControlService } = await load('apps/api/src/operations-control/operations-control.service.ts', opts);
const { PromotionsService } = await load('apps/api/src/promotions/promotions.service.ts', opts);
const { StockAlertService } = await load('apps/api/src/sales/stock-alert.service.ts', opts);
const { SupervisorApprovalService } = await load('apps/api/src/supervisor-approval/supervisor-approval.service.ts', opts);
const accounting = new AccountingCoreService(prisma);
const products = new ProductsService(prisma);
const sales = new SalesService(prisma, accounting, new StockAlertService(prisma), new PromotionsService(prisma), new SupervisorApprovalService(prisma));
const orders = new OrdersService(prisma, accounting, { get: () => 'synthetic-p6b-test-key-only-00000000' }, null, new PromotionsService(prisma));
const returns = new ReturnsService(prisma, accounting, new OperationsControlService(prisma), null);
const user = { sub: 'p6b-user', companyId: 'p6b-company', branchId: 'p6b-branch', roles: ['ADMIN'], permissions: [] };

function label(key, quantity) {
  const body = `${key}${String(quantity).padStart(5, '0')}`;
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return body + (10 - sum % 10) % 10;
}
async function product(id, unit = 'UNIT', stock = 0, costPrice = 10, salePrice = 25) {
  const row = await products.create({ sku: id, name: id, unit, costPrice, salePrice }, user);
  if (stock) await prisma.inventory.create({ data: { productId: row.id, warehouseId: 'p6b-wh', quantity: stock, available: stock } });
  return row;
}
async function stock(id) { return (await prisma.inventory.findUnique({ where: { warehouseId_productId: { warehouseId: 'p6b-wh', productId: id } } }))?.quantity ?? 0; }

before(async () => {
  writeFileSync(path.join(dir, 'test.db'), '');
  execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', path.join(root, 'apps/api/prisma/schema.sqlite.prisma')], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  await prisma.company.create({ data: { id: user.companyId, name: 'TEST P6B', slug: 'test-p6b' } });
  await prisma.branch.create({ data: { id: user.branchId, companyId: user.companyId, code: 'P6B', name: 'TEST' } });
  await prisma.user.create({ data: { id: user.sub, name: 'Synthetic operator', email: 'p6b@example.invalid', passwordHash: 'synthetic-fixture-only' } });
  await prisma.warehouse.create({ data: { id: 'p6b-wh', branchId: user.branchId, code: 'P6B', name: 'TEST', isDefault: true } });
  for (const code of ['GR', 'UNIT']) await prisma.masterReference.create({ data: { companyId: user.companyId, type: 'UNIT', code, name: code } });
  await prisma.masterReference.create({ data: { companyId: user.companyId, type: 'PAYMENT_METHOD', code: 'CASH', name: 'Tunai' } });
  for (const [code, type] of [['1101','ASSET'],['1301','ASSET'],['4101','REVENUE'],['4102','REVENUE'],['5101','EXPENSE'],['2201','LIABILITY']]) await prisma.account.create({ data: { branchId: user.branchId, code, type, name: code } });
  for (const [eventType, journalLines] of [
    ['SALE_CASH', [{ accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement' },{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['SALE_RETURN', [{accountCodeKey:'returns',side:'DEBIT',amountKey:'net'},{accountCodeKey:'inventory',side:'DEBIT',amountKey:'inventory',skipIfZero:true},{accountCodeKey:'cogs',side:'CREDIT',amountKey:'cogs',skipIfZero:true}]],
  ]) await prisma.accountingPostingRule.create({ data: { companyId:user.companyId,code:eventType,name:eventType,eventType,status:'ACTIVE',journalLines } });
});
after(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

test('scale format rejects checksum/zero; gallery rejects unsafe or credential-bearing URL', () => {
  assert.deepEqual(decodeWeightBarcode(label('2100123', 250)), { barcodeKey:'2100123',encodedQuantity:250 });
  assert.throws(() => decodeWeightBarcode(label('2100123',250).slice(0,12) + '9'), /Checksum/);
  assert.throws(() => decodeWeightBarcode(label('2100123',0)), /lebih besar/);
  assert.equal(decodeWeightBarcode('899000001'), null);
  for (const url of ['javascript:alert(1)','//host/a.png','https://user:secret@example.invalid/a.png','https://example.invalid/a.png?token=x','/../a.png']) assert.throws(() => normalizeRetailPolicy({gallery:[{url,alt:'test'}]}));
});

test('weighted sale and replay preserve exact GR quantity, price, movement and altered-payload denial', async () => {
  const row = await product('p6b-weight', 'GR', 1000, 2, 4);
  const policy = { gallery:[{url:'/catalog/weight.webp',alt:'Barang timbang'}],weight:{barcodeKey:'2100123',baseUnitsPerEncodedUnit:1} };
  await products.configureRetail(row.id, {operationKey:'config-weight',policy}, user);
  await products.configureRetail(row.id, {operationKey:'config-weight',policy}, user);
  await assert.rejects(() => products.configureRetail(row.id, {operationKey:'config-weight',policy:{gallery:[]}},user), /payload berbeda/);
  const scanned = label('2100123',250);
  const catalog = await products.list(user,undefined,undefined,undefined,scanned);
  assert.equal(catalog.items[0].scaleQuantity,250);
  const request={warehouseId:'p6b-wh',idempotencyKey:'weighed-sale',items:[{productId:row.id,barcodeCode:scanned,quantity:250}],paymentMethod:'CASH'};
  const sale=await sales.create(request,user);
  assert.equal(Number(sale.total),1000);
  assert.equal(sale.items[0].quantity,250);
  assert.equal(await stock(row.id),750);
  const replay=await sales.create(request,user);assert.equal(replay.id,sale.id);assert.equal(await stock(row.id),750);
  await assert.rejects(() => sales.create({...request,idempotencyKey:'tamper',items:[{productId:row.id,barcodeCode:scanned,quantity:251}]},user), /timbangan/);
  assert.equal(await prisma.inventoryMovement.count({where:{productId:row.id,type:'SALE'}}),1);
});

test('kit consumes components and historical return restores original BOM after current recipe edit', async () => {
  const a=await product('p6b-a','UNIT',20,10);const b=await product('p6b-b','UNIT',20,30);const kit=await product('p6b-kit','UNIT',0,999,100);
  const recipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-KIT',name:'Kit',outputProductId:kit.id,outputQtyPerBatch:1,items:{create:[{componentProductId:a.id,quantityPerBatch:2},{componentProductId:b.id,quantityPerBatch:1}]}}});
  await products.configureRetail(kit.id,{operationKey:'kit-config',policy:{kitRecipeId:recipe.id}},user);
  const catalog=await products.list(user,undefined,undefined,undefined,'p6b-kit');assert.equal(catalog.items[0].inventories[0].available,10);
  const request={warehouseId:'p6b-wh',idempotencyKey:'kit-sale',items:[{productId:kit.id,quantity:2}],paymentMethod:'CASH'};
  const sale=await sales.create(request,user);assert.equal(Number(sale.costTotal),100);assert.equal(await stock(a.id),16);assert.equal(await stock(b.id),18);assert.equal(await stock(kit.id),0);
  await sales.create(request,user);assert.equal(await stock(a.id),16);
  await prisma.productionRecipeItem.updateMany({where:{recipeId:recipe.id,componentProductId:a.id},data:{quantityPerBatch:8}});
  const returned=await returns.createSaleReturn({saleId:sale.id,warehouseId:'p6b-wh',items:[{saleItemId:sale.items[0].id,quantity:1}],refundMethod:'ORIGINAL'},user);
  await assert.rejects(() => returns.confirmSaleReturn(returned.id,{},user), /Pemeriksaan/);
  await prisma.operationalInspection.update({where:{id:returned.inspectionId},data:{status:'PASSED'}});
  await returns.confirmSaleReturn(returned.id,{},user);
  assert.equal(await stock(a.id),18);assert.equal(await stock(b.id),19);assert.equal(await stock(kit.id),0);
  const journalRows=await prisma.journalEntry.findMany({include:{lines:true}});
  for(const journal of journalRows) assert.equal(journal.lines.reduce((sum,line)=>sum+Number(line.debit)-Number(line.credit),0),0);
});

test('retail configuration refuses another tenant and tracked products', async () => {
  const row=await product('p6b-private');
  await assert.rejects(() => products.configureRetail(row.id,{operationKey:'other',policy:{}},{...user,companyId:'other'}), /company|Product/i);
  await prisma.product.update({where:{id:row.id},data:{trackSerial:true}});
  await assert.rejects(() => products.configureRetail(row.id,{operationKey:'tracked',policy:{weight:{barcodeKey:'2100999',baseUnitsPerEncodedUnit:1}}},user), /non-tracked/);
});

test('kit order reservation and cancellation use snapshot components after a BOM change', async () => {
  const component=await product('p6b-order-component','UNIT',20,7);const kit=await product('p6b-order-kit','UNIT',0,999,50);
  const recipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-ORDER',name:'Order kit',outputProductId:kit.id,outputQtyPerBatch:1,items:{create:[{componentProductId:component.id,quantityPerBatch:3}]}}});
  await products.configureRetail(kit.id,{operationKey:'order-kit-config',policy:{kitRecipeId:recipe.id}},user);
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'COURIER',code:'PICKUP',name:'Pickup',metadata:{fulfillmentType:'PICKUP'}}});
  const request={branchCode:'P6B',warehouseId:'p6b-wh',customerName:'Synthetic customer',fulfillmentType:'PICKUP',idempotencyKey:'p6b-order',items:[{productId:kit.id,quantity:2}]};
  const order=await orders.create(request);
  const balance=await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6b-wh',productId:component.id}}});
  assert.equal(balance.reserved,6);assert.equal(balance.available,14);assert.equal(Number(order.items[0].unitCost),21);
  assert.equal((await orders.create(request)).id,order.id);
  await prisma.productionRecipeItem.updateMany({where:{recipeId:recipe.id},data:{quantityPerBatch:9}});
  await orders.cancel(order.id,{reason:'TEST snapshot cancellation'},user);
  const released=await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6b-wh',productId:component.id}}});
  assert.equal(released.reserved,0);assert.equal(released.available,20);assert.equal(released.quantity,20);
});

test('concurrent kit sales cannot oversell their shared component', async () => {
  const component=await product('p6b-concurrent-component','UNIT',3,10);const kit=await product('p6b-concurrent-kit','UNIT',0,999,50);
  const recipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-CONCURRENT',name:'Concurrent kit',outputProductId:kit.id,outputQtyPerBatch:1,items:{create:[{componentProductId:component.id,quantityPerBatch:2}]}}});
  await products.configureRetail(kit.id,{operationKey:'concurrent-kit-config',policy:{kitRecipeId:recipe.id}},user);
  const results=await Promise.allSettled(['left','right'].map((key)=>sales.create({warehouseId:'p6b-wh',idempotencyKey:`kit-concurrent-${key}`,paymentMethod:'CASH',items:[{productId:kit.id,quantity:1}]},user)));
  assert.equal(results.filter((row)=>row.status==='fulfilled').length,1);assert.equal(await stock(component.id),1);
  assert.equal(await prisma.inventoryMovement.count({where:{productId:component.id,type:'SALE'}}),1);
});


test('kit policy rejects physical parent stock, nested kits, and keeps inactive BOM editable', async () => {
  const component=await product('p6b-policy-component','UNIT',10);const kit=await product('p6b-policy-kit');
  const recipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-POLICY',name:'Policy kit',outputProductId:kit.id,outputQtyPerBatch:1,items:{create:[{componentProductId:component.id,quantityPerBatch:1}]}}});
  await prisma.inventory.create({data:{warehouseId:'p6b-wh',productId:kit.id,quantity:1,available:1}});
  await assert.rejects(()=>products.configureRetail(kit.id,{operationKey:'stock-parent',policy:{kitRecipeId:recipe.id}},user),/stok.*parent/i);
  await prisma.inventory.deleteMany({where:{productId:kit.id}});
  await products.configureRetail(kit.id,{operationKey:'empty-parent',policy:{kitRecipeId:recipe.id}},user);
  const parent=await product('p6b-nested-parent');
  const parentRecipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-NESTED',name:'Nested',outputProductId:parent.id,outputQtyPerBatch:1,items:{create:[{componentProductId:kit.id,quantityPerBatch:1}]}}});
  await assert.rejects(()=>products.configureRetail(parent.id,{operationKey:'nested',policy:{kitRecipeId:parentRecipe.id}},user),/non-kit/);
  await prisma.productionRecipe.update({where:{id:recipe.id},data:{isActive:false}});
  const catalog=await products.list(user,undefined,undefined,undefined,kit.sku);
  const row=catalog.items.find((item)=>item.id===kit.id);assert.deepEqual(row.inventories,[]);assert.match(row.retailAvailabilityError,/BOM/);
  await assert.rejects(()=>sales.create({warehouseId:'p6b-wh',idempotencyKey:'stale-bom',paymentMethod:'CASH',items:[{productId:kit.id,quantity:1}]},user),/BOM/);
  await products.configureRetail(kit.id,{operationKey:'disable-stale',policy:{}},user);
});


test('manufacturing cannot post physical output for an opt-in virtual kit', async () => {
  const component=await product('p6b-prod-component','UNIT',10);const kit=await product('p6b-prod-kit');
  const recipe=await prisma.productionRecipe.create({data:{companyId:user.companyId,code:'P6B-PROD',name:'Production guard',outputProductId:kit.id,outputQtyPerBatch:1,items:{create:[{componentProductId:component.id,quantityPerBatch:2}]}}});
  await products.configureRetail(kit.id,{operationKey:'production-kit',policy:{kitRecipeId:recipe.id}},user);
  const manufacturing=new ManufacturingService(prisma,accounting);
  const order=await manufacturing.createOrder({recipeId:recipe.id,warehouseId:'p6b-wh',batchCount:1},user);
  await manufacturing.release(order.id,user);await manufacturing.start(order.id,user);
  await assert.rejects(()=>manufacturing.complete(order.id,{},user),/Kit virtual/);
  assert.equal(await stock(component.id),10);assert.equal(await stock(kit.id),0);
  assert.equal((await prisma.productionOrder.findUnique({where:{id:order.id}})).status,'IN_PROGRESS');
  assert.equal(await prisma.accountingEvent.count({where:{sourceType:'ProductionOrder',sourceId:order.id}}),0);
});
