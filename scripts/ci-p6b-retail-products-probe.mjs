#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Prisma } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p6b-retail-products-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P6B runtime probe tidak tersedia.');

function assertNonProductionPostgresTarget() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL P6B runtime probe tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('P6B runtime probe wajib berjalan pada PostgreSQL non-production runtime.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expectedHost = String(process.env.T360_CI_EXPECTED_HOST || process.env.T360_UAT_EXPECTED_HOST || '').trim();
  const expectedDatabase = String(process.env.T360_CI_EXPECTED_DATABASE || process.env.T360_UAT_EXPECTED_DATABASE || '').trim();
  if (!expectedHost || !expectedDatabase) throw new Error('Target lock host/database P6B runtime probe wajib tersedia.');
  if (url.hostname !== expectedHost || database !== expectedDatabase) {
    throw new Error(`P6B runtime target mismatch: actual=${url.hostname}/${database}, expected=${expectedHost}/${expectedDatabase}.`);
  }
  if (/\b(prod|production|live)\b/i.test(`${url.hostname}/${database}`)) throw new Error('P6B runtime probe menolak database production/live.');
  return { host: url.hostname, database };
}

const runtimeTarget = assertNonProductionPostgresTarget();
const prisma = new PrismaClient();
const stamp = Date.now();
const suffix = String(stamp).slice(-9);
const checks = {};

async function request(route, { method = 'GET', body, token, headers = {}, expect } = {}) {
  const requestHeaders = { accept: 'application/json', ...headers };
  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${api}${route}`, { method, headers: requestHeaders, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expect !== undefined) {
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: ${text.slice(0, 1200)}`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 1200)}`);
  return data;
}

function asDecimal(value) { return new Prisma.Decimal(value ?? 0); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=';

async function completeAndApproveInspection(inspectionId, sourceType, token, { barcodeValue } = {}) {
  let rows = await prisma.inspectionResultItem.findMany({ where: { inspectionId }, orderBy: { id: 'asc' } });
  assert(rows.length > 0, `${sourceType} inspection tidak memiliki result rows.`);

  if (sourceType === 'Shipment') {
    assert(barcodeValue, 'Shipment inspection membutuhkan barcode/SKU produk untuk evidence policy.');
    await request(`/operations-control/inspections/${inspectionId}/evidence`, {
      method: 'POST', token,
      body: { evidenceType: 'PHOTO', mimeType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64, metadata: { runtimeProbe: 'P6B' } },
    });
    const scanTarget = rows.filter((row) => row.productId && (row.expectedQty ?? 0) > 0).reduce((sum, row) => sum + (row.expectedQty ?? 0), 0);
    assert(scanTarget > 0, 'Shipment inspection tidak memiliki target scan produk.');
    for (let scan = 0; scan < scanTarget; scan += 1) {
      await request(`/operations-control/inspections/${inspectionId}/evidence`, {
        method: 'POST', token,
        body: { evidenceType: 'BARCODE', value: barcodeValue, metadata: { runtimeProbe: 'P6B', scan: scan + 1 } },
      });
    }
    rows = await prisma.inspectionResultItem.findMany({ where: { inspectionId }, orderBy: { id: 'asc' } });
  }

  const results = rows.map((row) => {
    const expected = row.expectedQty ?? undefined;
    return {
      ...(row.templateItemId ? { templateItemId: row.templateItemId } : {}),
      code: row.code,
      label: row.label,
      result: 'PASS',
      ...(row.productId ? { productId: row.productId } : {}),
      ...(expected !== undefined ? { expectedQty: expected, acceptedQty: expected, rejectedQty: 0, damagedQty: 0, missingQty: 0, extraQty: 0 } : {}),
      ...(row.scannedQty !== null ? { scannedQty: row.scannedQty } : {}),
    };
  });
  const completed = await request(`/operations-control/inspections/${inspectionId}/complete`, {
    method: 'POST', token,
    body: { results, notes: `P6B runtime ${sourceType} inspection` },
  });
  assert(['PASSED','PARTIAL','REVIEW_REQUIRED'].includes(completed?.status), `${sourceType} inspection tidak selesai dalam status yang dapat disetujui: ${completed?.status}.`);
  const approved = await request(`/operations-control/inspections/${inspectionId}/approve`, {
    method: 'POST', token,
    body: { notes: `P6B runtime ${sourceType} approval` },
  });
  assert(approved?.status === 'APPROVED', `${sourceType} inspection tidak APPROVED melalui API.`);
  return approved;
}

async function assertBalancedJournal(accountingEventId, label) {
  const event = await prisma.accountingEvent.findUnique({ where: { id: accountingEventId } });
  assert(event?.status === 'POSTED', `${label} accounting event belum POSTED.`);
  assert(event.journalEntryId, `${label} accounting event tidak memiliki journal entry.`);
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: event.journalEntryId } });
  assert(lines.length >= 2, `${label} journal lines tidak lengkap.`);
  const debit = lines.reduce((sum, line) => sum.add(line.debit), new Prisma.Decimal(0));
  const credit = lines.reduce((sum, line) => sum.add(line.credit), new Prisma.Decimal(0));
  assert(debit.equals(credit), `${label} journal tidak seimbang: debit=${debit.toFixed(2)} credit=${credit.toFixed(2)}.`);
  return event;
}

try {
  const login = await request('/auth/login', { method: 'POST', body: { email, password } });
  const token = login.accessToken;
  assert(token, 'P6B login gagal.');
  const manifest = await request('/platform/manifest', { token });
  const companyId = manifest.company?.id; const branchId = manifest.branch?.id;
  assert(companyId && branchId, 'Trusted tenant context tidak tersedia.');
  const warehouses = await request('/inventory/warehouses', { token });
  const warehouse = warehouses.find((row) => row.isActive);
  assert(warehouse, 'Gudang fixture tidak tersedia.');
  const units = await request('/master-data/references?type=UNIT', { token });
  const baseUnit = units.find((row) => row.isActive && !row.branchId)?.code;
  assert(baseUnit, 'Master UNIT tidak tersedia.');
  let grams = units.find((row) => row.code === 'GR' && !row.branchId);
  if (!grams) grams = await request('/master-data/references',{method:'POST',token,body:{type:'UNIT',code:'GR',name:'Gram'}});
  else if (!grams.isActive) await request(`/master-data/references/${grams.id}`,{method:'PATCH',token,body:{isActive:true}});
  async function createProduct(tag, quantity, costPrice, salePrice, unit = baseUnit) {
    const product = await request('/products', { method:'POST',token,body:{sku:`P6B-${suffix}-${tag}`,name:`P6B ${suffix} ${tag}`,unit,productType:'PHYSICAL',costPrice,salePrice} });
    // Synthetic bootstrap fixture only, guarded by expected PostgreSQL host/database above.
    if (quantity) await prisma.inventory.create({data:{warehouseId:warehouse.id,productId:product.id,quantity,available:quantity}});
    return product;
  }
  async function quantity(productId) { const row=await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:warehouse.id,productId}}});return row?.quantity??0; }
  const weighted = await createProduct('WEIGHT',1000,2,4,'GR');
  const barcodeKey = '21'+suffix.slice(-5);
  const policy={gallery:[{url:'/catalog/p6b.webp',alt:'P6B weighted product'}],weight:{barcodeKey,baseUnitsPerEncodedUnit:1}};
  const config={operationKey:`p6b-config-${suffix}`,policy};
  await request(`/products/${weighted.id}/retail-config`,{method:'POST',token,body:config});
  await request(`/products/${weighted.id}/retail-config`,{method:'POST',token,body:config});
  await request(`/products/${weighted.id}/retail-config`,{method:'POST',token,body:{...config,policy:{}},expect:400});
  const body=barcodeKey+'00250';const checksum=[...body].reduce((sum,digit,i)=>sum+Number(digit)*(i%2?3:1),0);
  const code=body+(10-checksum%10)%10;
  const catalog=await request(`/products?search=${code}`,{token});
  assert(catalog.items[0]?.scaleQuantity===250,'Scale catalog tidak mempertahankan berat integer.');
  const saleRequest={warehouseId:warehouse.id,idempotencyKey:`p6b-weight-sale-${suffix}`,paymentMethod:'CASH',items:[{productId:weighted.id,barcodeCode:code,quantity:250}]};
  const sale=await request('/sales',{method:'POST',token,body:saleRequest});
  const replay=await request('/sales',{method:'POST',token,body:saleRequest});
  assert(replay.id===sale.id && Number(sale.total)===1000 && await quantity(weighted.id)===750,'Weighted sale/replay berbeda dari stok/harga authoritative.');
  await request('/sales',{method:'POST',token,body:{...saleRequest,idempotencyKey:`p6b-weight-tamper-${suffix}`,items:[{...saleRequest.items[0],quantity:251}]},expect:400});
  checks.weightedSaleAndReplay=true;checks.configReplayConflict=true;
  const a=await createProduct('A',20,10,25);const b=await createProduct('B',20,30,40);const kit=await createProduct('KIT',0,999,100);
  const recipe=await request('/manufacturing/recipes',{method:'POST',token,body:{code:`P6B-${suffix}`,name:'P6B Kit',outputProductId:kit.id,outputQtyPerBatch:1,items:[{componentProductId:a.id,quantityPerBatch:2},{componentProductId:b.id,quantityPerBatch:1}]}});
  await request(`/products/${kit.id}/retail-config`,{method:'POST',token,body:{operationKey:`p6b-kit-${suffix}`,policy:{kitRecipeId:recipe.id}}});
  const kitRequest={warehouseId:warehouse.id,idempotencyKey:`p6b-kit-sale-${suffix}`,paymentMethod:'CASH',items:[{productId:kit.id,quantity:2}]};
  const kitSale=await request('/sales',{method:'POST',token,body:kitRequest});
  await request('/sales',{method:'POST',token,body:kitRequest});
  assert(Number(kitSale.costTotal)===100 && await quantity(a.id)===16 && await quantity(b.id)===18 && await quantity(kit.id)===0,'Kit stok/COGS/replay tidak tepat.');
  const original=await prisma.saleItem.findFirstOrThrow({where:{saleId:kitSale.id}});
  assert(original.inventoryComponents?.components?.length===2,'Snapshot komponen tidak tersimpan.');
  // Change current BOM via a new canonical version, then switch policy; history must not change.
  const next=await request('/manufacturing/recipes',{method:'POST',token,body:{code:`P6B-NEXT-${suffix}`,name:'P6B Kit next',outputProductId:kit.id,outputQtyPerBatch:1,items:[{componentProductId:a.id,quantityPerBatch:8},{componentProductId:b.id,quantityPerBatch:1}]}});
  await request(`/products/${kit.id}/retail-config`,{method:'POST',token,body:{operationKey:`p6b-kit-next-${suffix}`,policy:{kitRecipeId:next.id}}});
  const returned=await request('/returns/sales',{method:'POST',token,body:{saleId:kitSale.id,warehouseId:warehouse.id,refundMethod:'ORIGINAL',reason:'P6B historical kit snapshot',items:[{saleItemId:original.id,quantity:1}]}});
  await request(`/returns/sales/${returned.id}/confirm`,{method:'POST',token,body:{},expect:400});
  await completeAndApproveInspection(returned.inspectionId,'SaleReturn',token);
  await request(`/returns/sales/${returned.id}/confirm`,{method:'POST',token,body:{}});
  assert(await quantity(a.id)===18 && await quantity(b.id)===19 && await quantity(kit.id)===0,'Retur membaca resep baru atau mengembalikan stok parent kit.');
  const saleEvent = await prisma.accountingEvent.findFirstOrThrow({where:{companyId,branchId,sourceType:'Sale',sourceId:kitSale.id,status:'POSTED'}});
  const returnEvent = await prisma.accountingEvent.findFirstOrThrow({where:{companyId,branchId,sourceType:'SaleReturn',sourceId:returned.id,status:'POSTED'}});
  await assertBalancedJournal(saleEvent.id,'P6B kit sale');
  await assertBalancedJournal(returnEvent.id,'P6B kit return');
  checks.kitComponentStockAndCogs=true;checks.historicalKitReturn=true;checks.inspectionAndJournalBalance=true;
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify({status:'PASS',generatedAt:new Date().toISOString(),sourceIdentity:sourceFingerprint(root),runtimeTarget,checks,humanStage20:'PENDING'},null,2)+'\n');
  console.log('P6B PostgreSQL retail products probe PASS');
} finally { await prisma.$disconnect(); }
