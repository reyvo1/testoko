#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PrismaClient, Prisma } from '@prisma/client';
import { sourceFingerprint } from './lib/source-fingerprint.mjs';

const root = process.cwd();
const output = path.join(root, 'handoff/quality/github-p6cd-retail-products-probe-latest.json');
const api = String(process.env.T360_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = process.env.T360_UAT_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
const password = process.env.T360_UAT_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Credential P6CD runtime probe tidak tersedia.');

function assertNonProductionPostgresTarget() {
  const raw = String(process.env.DATABASE_URL || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL P6CD runtime probe tidak valid.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('P6CD runtime probe wajib berjalan pada PostgreSQL non-production runtime.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const expectedHost = String(process.env.T360_CI_EXPECTED_HOST || process.env.T360_UAT_EXPECTED_HOST || '').trim();
  const expectedDatabase = String(process.env.T360_CI_EXPECTED_DATABASE || process.env.T360_UAT_EXPECTED_DATABASE || '').trim();
  if (!expectedHost || !expectedDatabase) throw new Error('Target lock host/database P6CD runtime probe wajib tersedia.');
  if (url.hostname !== expectedHost || database !== expectedDatabase) {
    throw new Error(`P6CD runtime target mismatch: actual=${url.hostname}/${database}, expected=${expectedHost}/${expectedDatabase}.`);
  }
  if (/\b(prod|production|live)\b/i.test(`${url.hostname}/${database}`)) throw new Error('P6CD runtime probe menolak database production/live.');
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
    if (response.status !== expect) throw new Error(`${method} ${route} expected ${expect}, got ${response.status}: [response omitted to protect customer data]`);
    return data;
  }
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: [response omitted to protect customer data]`);
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
      body: { evidenceType: 'PHOTO', mimeType: 'image/png', dataBase64: ONE_PIXEL_PNG_BASE64, metadata: { runtimeProbe: 'P6CD' } },
    });
    const scanTarget = rows.filter((row) => row.productId && (row.expectedQty ?? 0) > 0).reduce((sum, row) => sum + (row.expectedQty ?? 0), 0);
    assert(scanTarget > 0, 'Shipment inspection tidak memiliki target scan produk.');
    for (let scan = 0; scan < scanTarget; scan += 1) {
      await request(`/operations-control/inspections/${inspectionId}/evidence`, {
        method: 'POST', token,
        body: { evidenceType: 'BARCODE', value: barcodeValue, metadata: { runtimeProbe: 'P6CD', scan: scan + 1 } },
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
    body: { results, notes: `P6CD runtime ${sourceType} inspection` },
  });
  assert(['PASSED','PARTIAL','REVIEW_REQUIRED'].includes(completed?.status), `${sourceType} inspection tidak selesai dalam status yang dapat disetujui: ${completed?.status}.`);
  const approved = await request(`/operations-control/inspections/${inspectionId}/approve`, {
    method: 'POST', token,
    body: { notes: `P6CD runtime ${sourceType} approval` },
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
  const login = await request('/auth/login',{method:'POST',body:{email,password}}); const token = login.accessToken;
  const manifest = await request('/platform/manifest',{token}); const companyId = manifest.company?.id;const branchId = manifest.branch?.id;const branchCode = manifest.branch?.code;
  assert(companyId && branchId && branchCode,'Missing trusted context.');
  const warehouses = await request('/inventory/warehouses',{token}); const warehouse = warehouses.find(row=>row.branchId===branchId && row.isActive && row.isDefault) ?? warehouses.find(row=>row.branchId===branchId && row.isActive);assert(warehouse,'Missing branch warehouse.');
  const references = await request('/master-data/references?type=UNIT',{token});const unit = references.find(row=>row.isActive && !row.branchId)?.code;assert(unit,'Missing UNIT.');
  const priorFlags = await request('/platform/features',{token});
  async function feature(key,enabled,config={}) {return request('/platform/features',{method:'POST',token,body:{key,branchId,enabled,config}});}
  const depositCode = `P6DEP${suffix}`;
  await request('/accounting-core/accounts',{method:'POST',token,body:{code:depositCode,name:'Synthetic TEST customer deposit',type:'LIABILITY'}});
  for (const key of ['retail_exchange','customer_deposit','customer_campaign','pos_ship_later','tax_export']) await feature(key,true,key==='customer_deposit'?{accountCode:depositCode}:{});
  let shift = await request('/sales/shifts/current',{token});if(!shift)shift=await request('/sales/shifts/open',{method:'POST',token,body:{openingCash:0}});
  const createdCustomer = await request('/storefront/account/register',{method:'POST',body:{branchCode,name:'Synthetic P6CD TEST customer',email:`p6cd-${suffix}@example.invalid`,password:'Synthetic-TEST-only-P6cd!0000',address:'Synthetic TEST address'}});
  const customerId = createdCustomer.customer.id;const customerToken = createdCustomer.sessionToken;
  // TEST-only identity verification fixture, never production/transport certification.
  await prisma.customer.update({where:{id:customerId},data:{emailVerifiedAt:new Date(),taxIdNumber:'0000000000000001'}});
  const customerHeaders={'x-branch-code':branchCode,'x-customer-session':customerToken};
  const preferences={operationKey:`preferences-${suffix}`,marketingEmail:true,marketingWhatsapp:false,receiptEmail:true,receiptWhatsapp:false};
  await request('/storefront/account/communication-preferences',{method:'PATCH',headers:customerHeaders,body:preferences});
  async function product(tag,price){const row=await request('/products',{method:'POST',token,body:{sku:`P6CD-${suffix}-${tag}`,name:`Synthetic P6CD ${tag}`,unit,costPrice:10,salePrice:price}});await prisma.inventory.create({data:{warehouseId:warehouse.id,productId:row.id,quantity:20,available:20}});return row;}
  const original = await product('ORIGINAL',25);const replacement = await product('REPLACEMENT',40);
  const sale = await request('/sales',{method:'POST',token,body:{warehouseId:warehouse.id,customerId,paymentMethod:'CASH',idempotencyKey:`original-${suffix}`,items:[{productId:original.id,quantity:1}]}});
  const returned = await request('/returns/sales',{method:'POST',token,body:{saleId:sale.id,warehouseId:warehouse.id,refundMethod:'ORIGINAL',reason:'Synthetic TEST exchange',items:[{saleItemId:sale.items[0].id,quantity:1}]}});
  const exchange={operationKey:`exchange-${suffix}`,saleReturnId:returned.id,cashierShiftId:shift.id,expectedDifference:15,replacement:{warehouseId:warehouse.id,items:[{productId:replacement.id,quantity:1}]},confirmation:{}};
  await request('/returns/exchanges',{method:'POST',token,body:exchange,expect:400});
  await completeAndApproveInspection(returned.inspectionId,'SaleReturn',token);
  await request('/returns/exchanges',{method:'POST',token,body:{...exchange,expectedDifference:16},expect:400});assert((await prisma.saleReturn.findUnique({where:{id:returned.id}})).status!=='COMPLETED','Altered difference posted return.');
  const exchanges = await Promise.all([request('/returns/exchanges',{method:'POST',token,body:exchange}),request('/returns/exchanges',{method:'POST',token,body:exchange})]);assert(exchanges[0].id===exchanges[1].id,'Exchange duplicate.');
  const exchangeRow=await prisma.retailExchange.findUnique({where:{id:exchanges[0].id}});const replacementSale=await prisma.sale.findUnique({where:{id:exchangeRow.replacementSaleId}});await assertBalancedJournal(replacementSale.accountingEventId,'Exchange replacement');checks.exchangeAtomicReplayInspection=true;
  await request('/master-data/references',{method:'POST',token,body:{type:'PAYMENT_METHOD',code:`DEP${suffix}`,name:'Synthetic TEST deposit',branchId,metadata:{kind:'DEPOSIT',settlementAccountCode:depositCode,refundBehavior:'ORIGINAL',settlementBehavior:'IMMEDIATE',allowOffline:false,allowCashChange:false,requiresProvider:false,requiresReference:false,feeRatePercent:0}}});
  const deposit={customerId,kind:'CREDIT',amount:100,settlementAccountCode:'1101',operationKey:`deposit-${suffix}`};const receipt=await request('/finance-operations/customer-deposits',{method:'POST',token,body:deposit});await request(`/finance-operations/${receipt.id}/post`,{method:'POST',token,body:{},expect:400});await request(`/finance-operations/${receipt.id}/approve`,{method:'POST',token,body:{}});await request(`/finance-operations/${receipt.id}/post`,{method:'POST',token,body:{}});await request(`/finance-operations/${receipt.id}/post`,{method:'POST',token,body:{}});
  const depositItem=await product('DEPOSIT',60);const payload={warehouseId:warehouse.id,customerId,paymentMethod:`DEP${suffix}`,idempotencyKey:`consume-${suffix}`,items:[{productId:depositItem.id,quantity:1}]};const consumption=await request('/sales',{method:'POST',token,body:payload});await request('/sales',{method:'POST',token,body:payload});const balance=await request(`/finance-operations/customer-deposits/${customerId}/balance`,{token});assert(balance.available==='40.00','Deposit balance drift.');await assertBalancedJournal(consumption.accountingEventId,'Deposit sale');checks.depositApprovalConsumptionBalance=true;
  await request('/sales',{method:'POST',token,body:{...payload,idempotencyKey:`overdraw-${suffix}`},expect:400});
  const share=await request(`/sales/${encodeURIComponent(sale.number)}/receipt-link`,{token});assert(share.path.includes('?share='),'Unsigned receipt.');await request(`/receipts/${encodeURIComponent(sale.number)}`,{expect:404});const signed=await request(share.path);assert(typeof signed==='string' && signed.includes(sale.number),'Signed receipt unavailable.');
  await request(`/sales/${sale.id}/deliver-receipt`,{method:'POST',token,body:{operationKey:`send-receipt-${suffix}`,channel:'EMAIL'}});checks.secureReceiptConsent=true;
  await request('/notifications/templates',{method:'POST',token,body:{channel:'EMAIL',code:`P6CD${suffix}`,subject:'Synthetic TEST campaign',body:'Synthetic TEST notification',isActive:true}});const campaign=await request('/customer-campaigns',{method:'POST',token,body:{operationKey:`campaign-${suffix}`,channel:'EMAIL',templateCode:`P6CD${suffix}`}});
  const campaignDeadline=Date.now()+45000;let deliveries;while(Date.now()<campaignDeadline){deliveries=await request(`/customer-campaigns/${campaign.id}/deliveries`,{token});if(deliveries.items.length)break;await new Promise(resolve=>setTimeout(resolve,500));}assert(deliveries?.items.length>=1,'Campaign worker did not enqueue consented customers.');const campaignRows=await prisma.customerCampaignDelivery.findMany({where:{campaignId:campaign.id}});assert(campaignRows.some(row=>row.customerId===customerId),'Campaign omitted the verified opted-in customer.');for(const row of campaignRows){const pref=await prisma.customerCommunicationPreference.findUnique({where:{customerId:row.customerId}});const recipient=await prisma.customer.findFirst({where:{id:row.customerId,companyId}});assert(pref?.marketingEmail&&recipient?.emailVerifiedAt,'Campaign targeted an unverified/unconsented customer.');}await request(`/customer-campaigns/${campaign.id}/cancel`,{method:'POST',token,body:{operationKey:`cancel-${suffix}`}});checks.campaignRealWorkerConsentBatch=true;
  const pickupRefs=await request('/master-data/references?type=COURIER',{token});if(!pickupRefs.some(row=>row.isActive && row.metadata?.fulfillmentType==='PICKUP'))await request('/master-data/references',{method:'POST',token,body:{type:'COURIER',code:`PICKUP${suffix}`,name:'Synthetic TEST pickup',branchId,metadata:{fulfillmentType:'PICKUP',price:0}}});
  const staffOrder=await request('/orders/staff',{method:'POST',token,body:{operationKey:`staff-order-${suffix}`,warehouseId:warehouse.id,customerId,cashierShiftId:shift.id,fulfillmentType:'PICKUP',items:[{productId:replacement.id,quantity:1}]}});const paid=await request(`/orders/${staffOrder.id}/staff-cash`,{method:'POST',token,body:{operationKey:`staff-cash-${suffix}`,tenderCode:'CASH',expectedAmount:Number(staffOrder.total)}});assert(paid.status==='PAID' && !staffOrder.accessToken,'Staff order wrong authority/payment.');
  const shipment=await prisma.shipment.findFirstOrThrow({where:{orderId:staffOrder.id}});await request(`/orders/${staffOrder.id}/pack`,{method:'POST',token,body:{},expect:400});await completeAndApproveInspection(shipment.outboundInspectionId,'Shipment',token,{barcodeValue:replacement.sku});await request(`/orders/${staffOrder.id}/pack`,{method:'POST',token,body:{}});await request(`/orders/${staffOrder.id}/ship`,{method:'POST',token,body:{}});await request(`/orders/${staffOrder.id}/ship`,{method:'POST',token,body:{}});const storedOrder=await prisma.order.findUnique({where:{id:staffOrder.id}});await assertBalancedJournal(storedOrder.accountingEventId,'Staff fulfillment');checks.staffOrderCashInspectionFulfillment=true;
  const taxCode=await request('/accounting-core/tax-codes',{method:'POST',token,body:{code:`VAT${suffix}`,version:1,name:'Synthetic TEST VAT',scope:'SALE',rate:0.11,status:'ACTIVE',payableAccountCode:'2201',legalReference:'Synthetic TEST mapping, not production certification',calculationRules:{coretax:{vatRatePercent:'12',otherTaxBaseNumerator:'11',otherTaxBaseDenominator:'12'}}}});
  const taxProduct=await product('TAX',100);await request(`/products/${taxProduct.id}`,{method:'PATCH',token,body:{salesTaxCodeId:taxCode.id}});
  const taxSale=await request('/sales',{method:'POST',token,body:{warehouseId:warehouse.id,customerId,paymentMethod:'CASH',idempotencyKey:`tax-sale-${suffix}`,items:[{productId:taxProduct.id,quantity:1}]}});const documentId=taxSale.taxDocumentId;assert(documentId,'Missing tax document.');
  const contract='FAKTUR_PK_1_4';const mapping={SellerTIN:'0000000000000000',SellerIDTKU:'0000000000000000000000',TaxInvoiceOpt:'Normal',TrxCode:'01',BuyerDocument:'TIN',BuyerCountry:'IND',BuyerAdress:'Synthetic TEST address',goods:{[taxProduct.id]:{Opt:'A',Code:'000000',Unit:'UM.0001'}}};
  await request(`/accounting-core/tax-exports/documents/${documentId}/approve-mapping`,{method:'POST',token,body:{operationKey:`tax-mapping-${suffix}`,contract,mapping}});
  const exportJob=await request('/accounting-core/tax-exports',{method:'POST',token,body:{operationKey:`export-${suffix}`,contract,documentIds:[documentId]}});assert(exportJob.productionCertified===false,'Simulation claimed production certification.');
  const exportDeadline=Date.now()+45000;let job;while(Date.now()<exportDeadline){job=await prisma.reportJob.findUnique({where:{id:exportJob.id}});if(job.status==='DONE')break;if(['DEAD_LETTER','FAILED'].includes(job.status))throw new Error('Coretax worker failed.');await new Promise(resolve=>setTimeout(resolve,500));}assert(job?.status==='DONE','Coretax worker did not finish.');const xml=await request(`/reports/jobs/${job.id}/download`,{token});assert(typeof xml==='string' && xml.includes('<VAT>11.00</VAT>') && xml.includes('<OtherTaxBase>91.67</OtherTaxBase>'),'Coretax output did not preserve posted tax facts.');checks.coretaxRealWorkerXmlCanonical=true;
  // Synthetic TEST only: damaged checksum must retry and reach dead-letter without exposing legal facts.
  const rejectedJob=await prisma.reportJob.create({data:{companyId,branchId,requestedById:login.user.id,reportType:'CORETAX_XML',format:'XML',filters:{...job.filters,checksum:'synthetic-tampered-checksum'},maxAttempts:2,expiresAt:new Date(Date.now()+3600000)}});
  async function waitReportState(id,status){const deadline=Date.now()+45000;while(Date.now()<deadline){const row=await prisma.reportJob.findUnique({where:{id}});if(row.status===status)return row;if(row.status==='DONE'&&status!=='DONE')throw new Error('Rejected tax snapshot was rendered.');await new Promise(resolve=>setTimeout(resolve,400));}throw new Error(`Coretax worker did not reach ${status}.`);}
  const retry=await waitReportState(rejectedJob.id,'RETRY');assert(retry.attempts===1&&retry.nextAttemptAt&&!retry.leaseOwner&&!retry.outputUrl,'Coretax retry did not release its lease.');assert(!retry.errorMessage.includes('0000000000000001'),'Coretax error exposed legal identity.');
  // Advance only the isolated fixture's retry clock; actual claim/render policy stays unchanged.
  await prisma.reportJob.update({where:{id:rejectedJob.id},data:{nextAttemptAt:new Date(Date.now()-1000)}});const dead=await waitReportState(rejectedJob.id,'DEAD_LETTER');assert(dead.attempts===2&&!dead.outputUrl,'Coretax dead-letter attempts drifted.');
  const recoveredJob=await prisma.reportJob.create({data:{companyId,branchId,requestedById:login.user.id,reportType:'CORETAX_XML',format:'XML',filters:job.filters,status:'RUNNING',leaseOwner:'synthetic-expired-test-lease',leaseExpiresAt:new Date(Date.now()-1000),expiresAt:new Date(Date.now()+3600000)}});await waitReportState(recoveredJob.id,'DONE');checks.coretaxRetryDeadLetterLeaseRecovery=true;
  for(const key of ['retail_exchange','customer_deposit','customer_campaign','pos_ship_later','tax_export']){const prior=priorFlags.find(row=>row.key===key && row.branchId===branchId && !row.userId);await feature(key,prior?.enabled??false,prior?.config??(key==='customer_deposit'?{accountCode:depositCode}:{}));}
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({status:'PASS',generatedAt:new Date().toISOString(),sourceIdentity:sourceFingerprint(root),runtimeTarget,checks,humanStage20:'PENDING',productionProviderCertification:'PENDING',fixtureVerification:'SYNTHETIC_TEST_ONLY'},null,2)+'\n');console.log('P6CD PostgreSQL retail orchestration and XML worker probe PASS');
} finally {await prisma.$disconnect();}
