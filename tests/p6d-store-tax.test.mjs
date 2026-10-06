import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { load } from './helpers/import-ts.mjs';
import { contactHash, customerNotificationAllowed, processCustomerCampaignBatch } from '../packages/contracts/customer-communications.cjs';

const root = new URL('../', import.meta.url).pathname;
const dir = mkdtempSync(path.join(os.tmpdir(), 't360-p6d-'));
const url = `file:${path.join(dir, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const opts = { platform: 'node', external: ['@toko360/contracts/customer-communications.cjs','@toko360/contracts/coretax-export.cjs', '@prisma/client', '@nestjs/microservices', '@nestjs/websockets', '@nestjs/websockets/socket-module'] };
const imported = {};
for (const [name,file] of Object.entries({ SalesService:'sales/sales.service', ReturnsService:'returns/returns.service', ExchangesService:'returns/exchanges.service', FinanceOperationsService:'finance-operations/finance-operations.service', CustomerCommunicationsService:'storefront-customer/customer-communications.service', StorefrontCustomerService:'storefront-customer/storefront-customer.service', ReceiptController:'sales/receipt.controller', AccountingCoreService:'accounting-core/accounting-core.service', OperationsControlService:'operations-control/operations-control.service', PromotionsService:'promotions/promotions.service', StockAlertService:'sales/stock-alert.service', SupervisorApprovalService:'supervisor-approval/supervisor-approval.service', ProductsService:'products/products.service', OrdersService:'orders/orders.service', TaxExportsService:'accounting-core/tax-exports.service',ReportsService:'reports/reports.service' })) imported[name] = (await load(`apps/api/src/${file}.ts`, opts))[name];
const { mintReceiptShare, verifyReceiptShare } = await load('apps/api/src/common/receipt-access.ts', opts);
const config = { get: (key) => ({ JWT_SECRET:'synthetic-p6d-signing-key-not-production-0000', STOREFRONT_PUBLIC_URL:'http://localhost:3000', PUBLIC_API_URL:'http://localhost:4000/api/v1', NODE_ENV:'test' })[key] };
const user = { sub:'p6d-user', companyId:'p6d-company', branchId:'p6d-branch', roles:['OWNER'], permissions:['sale.create','sale.view','sale.return','sale.refund','finance.create','finance.approve','finance.post','notification.manage','shipment.manage','order.cancel','tax.view','tax.manage','report.export'] };
const accounting = new imported.AccountingCoreService(prisma);
const alerts = new imported.StockAlertService(prisma);
const sales = new imported.SalesService(prisma, accounting, alerts, new imported.PromotionsService(prisma), new imported.SupervisorApprovalService(prisma));
const returns = new imported.ReturnsService(prisma, accounting, new imported.OperationsControlService(prisma), new imported.StorefrontCustomerService(prisma, config));
const exchanges = new imported.ExchangesService(prisma, returns, sales, alerts);
const finance = new imported.FinanceOperationsService(prisma, accounting);
const customers = new imported.StorefrontCustomerService(prisma, config);
const communications = new imported.CustomerCommunicationsService(prisma, customers, config);
const receipts = new imported.ReceiptController(prisma, config);
const products = new imported.ProductsService(prisma);
const orders = new imported.OrdersService(prisma,accounting,config,customers,new imported.PromotionsService(prisma));
const taxExports = new imported.TaxExportsService(prisma);
const reports = new imported.ReportsService(prisma);
let sequence = 0;

async function enable(key, enabled = true, settings = {}) {
  const row = await prisma.featureFlag.findFirst({ where: { companyId:user.companyId, branchId:user.branchId, userId:null, key } });
  const data = { enabled, config:settings };
  return row ? prisma.featureFlag.update({where:{id:row.id},data}) : prisma.featureFlag.create({data:{companyId:user.companyId,branchId:user.branchId,key,scope:'BRANCH',...data}});
}
async function customer(tag, verified = true) {
  const id = `p6d-customer-${tag}`; const token = `synthetic-p6d-session-${tag}-not-production`;
  await prisma.customer.create({data:{id,companyId:user.companyId,name:'Synthetic TEST customer',email:`${tag}@example.invalid`,phone:`+620000${++sequence}`,emailVerifiedAt:verified?new Date():null,phoneVerifiedAt:verified?new Date():null,account:{create:{passwordHash:'synthetic-fixture-only'}}}});
  await prisma.customerSession.create({data:{customerId:id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  return { id, token };
}
async function product(tag, price = 60, stock = 30) {
  const row = await products.create({sku:`p6d-${tag}`,name:`TEST ${tag}`,unit:'UNIT',costPrice:10,salePrice:price},user);
  if(stock) await prisma.inventory.create({data:{warehouseId:'p6d-wh',productId:row.id,quantity:stock,available:stock}}); // Isolated synthetic TEST bootstrap only.
  return row;
}
async function quantity(id) { return (await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6d-wh',productId:id}}}))?.quantity??0; }
async function originalReturn(tag, price = 25) {
  const item = await product(tag,price);
  const sale = await sales.create({warehouseId:'p6d-wh',paymentMethod:'CASH',idempotencyKey:`original-${tag}`,items:[{productId:item.id,quantity:1}]},user);
  const returned = await returns.createSaleReturn({saleId:sale.id,warehouseId:'p6d-wh',refundMethod:'ORIGINAL',items:[{saleItemId:sale.items[0].id,quantity:1}]},user);
  return { item, sale, returned };
}
async function passInspection(id) { await prisma.operationalInspection.update({where:{id},data:{status:'PASSED'}}); } // Inspector fixture; real API inspection is required separately in PostgreSQL UAT.
async function credit(customerId, amount, tag) {
  const row = await finance.createCustomerDeposit({customerId,amount,kind:'CREDIT',settlementAccountCode:'1101',operationKey:tag},user);
  await assert.rejects(()=>finance.post(row.id,user),/status|disetujui/i);
  await finance.approve(row.id,{},user); await finance.post(row.id,user); return row;
}
function depositSale(item, customerId, tag) { return {warehouseId:'p6d-wh',customerId,paymentMethod:'DEPOSIT',idempotencyKey:tag,items:[{productId:item.id,quantity:1}]}; }

before(async()=>{
  writeFileSync(path.join(dir,'test.db'),'');
  execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',path.join(root,'apps/api/prisma/schema.sqlite.prisma')],{cwd:root,env:{...process.env,DATABASE_URL:url,RUST_LOG:'info'},stdio:'pipe'});
  await prisma.company.create({data:{id:user.companyId,name:'TEST P6D',slug:'p6d-test'}});
  await prisma.branch.create({data:{id:user.branchId,companyId:user.companyId,code:'P6D',name:'TEST'}});
  await prisma.user.create({data:{id:user.sub,branchId:user.branchId,name:'Synthetic TEST operator',email:'p6d-operator@example.invalid',passwordHash:'synthetic-fixture-only'}});
  await prisma.warehouse.create({data:{id:'p6d-wh',branchId:user.branchId,code:'P6D',name:'TEST',isDefault:true}});
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'UNIT',code:'UNIT',name:'Unit'}});
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'PAYMENT_METHOD',code:'CASH',name:'Kas'}});
  await prisma.masterReference.create({data:{companyId:user.companyId,branchId:user.branchId,type:'PAYMENT_METHOD',code:'DEPOSIT',name:'Deposit',metadata:{kind:'DEPOSIT',settlementAccountCode:'2302',settlementBehavior:'IMMEDIATE',refundBehavior:'ORIGINAL',allowOffline:false,allowCashChange:false,requiresProvider:false,requiresReference:false,feeRatePercent:0}}});
  for(const [code,type] of [['1101','ASSET'],['1102','ASSET'],['1301','ASSET'],['4101','REVENUE'],['4102','REVENUE'],['5101','EXPENSE'],['2201','LIABILITY'],['2302','LIABILITY'],['2105','LIABILITY'],['1201','ASSET']]) await prisma.account.create({data:{branchId:user.branchId,code,name:code,type}});
  for(const [eventType,journalLines] of [
    ['SALE_CASH',[{accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement'},{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'outputTax',side:'CREDIT',amountKey:'outputTax',skipIfZero:true},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['SALE_BANK',[{accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement'},{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'outputTax',side:'CREDIT',amountKey:'outputTax',skipIfZero:true},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['SALE_RETURN',[{accountCodeKey:'returns',side:'DEBIT',amountKey:'net'},{accountCodeKey:'inventory',side:'DEBIT',amountKey:'inventory',skipIfZero:true},{accountCodeKey:'cogs',side:'CREDIT',amountKey:'cogs',skipIfZero:true}]],
    ['BALANCE_TRANSFER',[{accountCodeKey:'debit',side:'DEBIT',amountKey:'gross'},{accountCodeKey:'credit',side:'CREDIT',amountKey:'gross'}]],
  ]) await prisma.accountingPostingRule.create({data:{companyId:user.companyId,code:eventType,name:eventType,eventType,status:'ACTIVE',journalLines}});
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'COURIER',code:'PICKUP',name:'Ambil di toko',metadata:{fulfillmentType:'PICKUP',price:0}}});
  for (const [eventType,journalLines] of [
    ['ONLINE_ORDER_PREPAYMENT',[{accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement'},{accountCodeKey:'customerAdvance',side:'CREDIT',amountKey:'customerAdvance'}]],
    ['ONLINE_ORDER_PREPAID_FULFILLED',[{accountCodeKey:'customerAdvance',side:'DEBIT',amountKey:'customerAdvance',skipIfZero:true},{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'outputTax',side:'CREDIT',amountKey:'outputTax',skipIfZero:true},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['ORDER_RETURN',[{accountCodeKey:'returns',side:'DEBIT',amountKey:'net'},{accountCodeKey:'settlement',side:'CREDIT',amountKey:'settlement'},{accountCodeKey:'inventory',side:'DEBIT',amountKey:'inventory',skipIfZero:true},{accountCodeKey:'cogs',side:'CREDIT',amountKey:'cogs',skipIfZero:true}]],
  ]) await prisma.accountingPostingRule.create({data:{companyId:user.companyId,code:eventType,name:eventType,eventType,status:'ACTIVE',journalLines}});
  await enable('pos_ship_later');await enable('tax_export');
  await enable('retail_exchange'); await enable('customer_deposit',true,{accountCode:'2302'}); await enable('customer_campaign');
  await sales.openShift(user,1000);
});
after(async()=>{await prisma.$disconnect();rmSync(dir,{recursive:true,force:true});});


const { renderCoretaxExport, taxExportChecksum, validateTaxExportMapping } = await import('../packages/contracts/coretax-export.cjs');
function staffDto(item,customerId,shiftId,key) {return {warehouseId:'p6d-wh',customerId,cashierShiftId:shiftId,fulfillmentType:'PICKUP',operationKey:key,items:[{productId:item.id,quantity:1}]};}

test('staff order reserves once, does not create a Sale, verifies total and posts canonical cash advance once',async()=>{
 const c=await customer('staff');const item=await product('staff',60);const shift=await sales.currentShift(user);const saleCount=await prisma.sale.count();
 const dto=staffDto(item,c.id,shift.id,'staff-create');const order=await orders.createStaff(dto,user);assert.equal((await orders.createStaff(dto,user)).id,order.id);assert(!('accessToken' in order));assert.equal(await prisma.sale.count(),saleCount);
 const inventory=await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6d-wh',productId:item.id}}});assert.equal(inventory.quantity,30);assert.equal(inventory.available,29);assert.equal(inventory.reserved,1);
 const cash={operationKey:'staff-cash',tenderCode:'CASH',expectedAmount:60};await assert.rejects(()=>orders.staffCash(order.id,{...cash,expectedAmount:61},user),/Total/);
 const results=await Promise.all([orders.staffCash(order.id,cash,user),orders.staffCash(order.id,cash,user)]);assert.equal(results[0].id,results[1].id);assert.equal((await prisma.order.findUnique({where:{id:order.id}})).status,'PAID');
 assert.equal((await prisma.payment.findFirst({where:{orderId:order.id}})).settlementAccountCode,'1101');const recap=await sales.shiftRecap(user,shift.id);assert.equal(recap.payments.CASH,60);assert.equal(recap.expectedCash,1060);
 await assert.rejects(()=>orders.cancelStaff(order.id,{reason:'must not refund paid order'},user),/pembayaran/);
 await assert.rejects(()=>orders.pack(order.id,user),/Inspeksi/);
 const shipment=await prisma.shipment.findFirst({where:{orderId:order.id}});await prisma.operationalInspection.update({where:{id:shipment.outboundInspectionId},data:{status:'APPROVED',mismatchCount:0,blockingFailureCount:0}}); // Isolated inspector fixture; HTTP probe covers real inspection commands.
 await orders.pack(order.id,user);await orders.ship(order.id,{},user);await orders.ship(order.id,{},user);await orders.deliver(order.id,user);
 assert.equal(await quantity(item.id),29);assert.equal(await prisma.inventoryMovement.count({where:{referenceType:'Order',referenceId:order.id}}),1);
 const stored=await prisma.order.findUnique({where:{id:order.id},include:{items:true}});
 const returned=await returns.createCustomerOrderReturn({orderId:order.id,reason:'Synthetic TEST return',idempotencyKey:'staff-return',items:[{orderItemId:stored.items[0].id,quantity:1}]},'P6D',c.token);
 const inspection=await returns.startOrderReturnInspection(returned.id,user);await prisma.inspectionResultItem.updateMany({where:{inspectionId:inspection.inspectionId},data:{result:'PASS',scannedQty:1,acceptedQty:1,rejectedQty:0,damagedQty:0}});await prisma.operationalInspection.update({where:{id:inspection.inspectionId},data:{status:'APPROVED'}});
 const refund=await returns.confirmOrderReturn(returned.id,{},user);assert.equal(refund.refundMethod,'CASH');await returns.confirmOrderReturn(returned.id,{},user);assert.equal(await quantity(item.id),30);
 const after=await sales.shiftRecap(user,shift.id);assert.equal(after.refunds.cashTotal,60);assert.equal(after.payments.CASH,60);assert.equal(after.expectedCash,1000);
});

test('staff order isolation, altered replay, flag rollback, reservation cancellation and locked-period cash safety',async()=>{
 const c=await customer('staff-denials');const other=await customer('staff-other');const item=await product('staff-denials',20);const shift=await sales.currentShift(user);const dto=staffDto(item,c.id,shift.id,'staff-denials');
 await assert.rejects(()=>orders.createStaff(dto,{...user,roles:['AUDITOR']}),/Izin/);await assert.rejects(()=>orders.createStaff(dto,{...user,branchId:'foreign'}),/Cabang/);
 const order=await orders.createStaff(dto,user);await assert.rejects(()=>orders.createStaff({...dto,customerId:other.id},user),/payload berbeda/);await assert.rejects(()=>sales.closeShift(user,1000),/pesanan/i);
 const lock=await prisma.accountingCloseControl.create({data:{companyId:user.companyId,branchId:user.branchId,module:'ACCOUNTING',periodStart:new Date(Date.now()-86400000),periodEnd:new Date(Date.now()+86400000),status:'CLOSED'}});
 await assert.rejects(()=>orders.staffCash(order.id,{operationKey:'locked-cash',tenderCode:'CASH',expectedAmount:20},user),/menutup posting/);assert.equal((await prisma.payment.findFirst({where:{orderId:order.id}})).status,'PENDING');await prisma.accountingCloseControl.update({where:{id:lock.id},data:{status:'OPEN'}});
 await enable('pos_ship_later',false);assert.equal((await orders.createStaff(dto,user)).id,order.id);await assert.rejects(()=>orders.staffCash(order.id,{operationKey:'disabled-cash',tenderCode:'CASH',expectedAmount:20},user),/belum aktif/);
 assert.equal((await orders.staffOrders(user,'1')).items[0].id,order.id);const cancelled=await orders.cancelStaff(order.id,{reason:'operator cancellation'},user);assert.equal(cancelled.status,'CANCELLED');await orders.cancelStaff(order.id,{reason:'operator cancellation'},user);
 const inventory=await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6d-wh',productId:item.id}}});assert.equal(inventory.available,30);assert.equal(inventory.reserved,0);await enable('pos_ship_later');
});

test('Coretax approved snapshots preserve posted VAT/DPP, escape XML, reject overrides and queue idempotent jobs',async()=>{
 const c=await customer('tax');await prisma.customer.update({where:{id:c.id},data:{taxIdNumber:'0000000000000001'}});
 const code=await prisma.taxCode.create({data:{companyId:user.companyId,code:'VAT-P6D',name:'Synthetic TEST VAT',scope:'SALE',rate:'0.11',status:'ACTIVE',calculationRules:{coretax:{vatRatePercent:'12',otherTaxBaseNumerator:'11',otherTaxBaseDenominator:'12'}}}});
 const item=await product('tax-item',100);await prisma.product.update({where:{id:item.id},data:{name:'TEST & <goods>',salesTaxCodeId:code.id}});
 const sale=await sales.create({warehouseId:'p6d-wh',customerId:c.id,paymentMethod:'CASH',idempotencyKey:'tax-sale',items:[{productId:item.id,quantity:1}]},user);const document=await prisma.taxDocument.findUnique({where:{id:sale.taxDocumentId}});assert.equal(Number(document.taxAmount),11);
 const contract='FAKTUR_PK_1_4';const mapping={SellerTIN:'0000000000000000',SellerIDTKU:'0000000000000000000000',TaxInvoiceOpt:'Normal',TrxCode:'01',BuyerDocument:'TIN',BuyerCountry:'IND',BuyerAdress:'Synthetic TEST address',goods:{[item.id]:{Opt:'A',Code:'000000',Unit:'UM.0001'}}};const dto={operationKey:'approve-invoice',contract,mapping};
 await assert.rejects(()=>taxExports.create({operationKey:'unreviewed',contract,documentIds:[document.id]},user),/direview/);await assert.rejects(()=>taxExports.approve(document.id,{...dto,mapping:{...mapping,VAT:'999'}},user),/Mapping legal/);
 await assert.rejects(()=>taxExports.approve(document.id,dto,{...user,branchId:'foreign'}),/tidak tersedia|belum aktif/);await assert.rejects(()=>taxExports.approve(document.id,dto,{...user,permissions:['tax.view']}),/Izin/);
 await taxExports.approve(document.id,dto,user);await taxExports.approve(document.id,dto,user);await assert.rejects(()=>taxExports.approve(document.id,{...dto,operationKey:'replace-approved'},user),/snapshot/);
 const request={operationKey:'export-invoice',contract,documentIds:[document.id]};const jobs=await Promise.all([taxExports.create(request,user),taxExports.create(request,user)]);assert.equal(jobs[0].id,jobs[1].id);assert.equal(jobs[0].productionCertified,false);
 const job=await prisma.reportJob.findUnique({where:{id:jobs[0].id}});const xml=renderCoretaxExport(job.filters);assert(xml.includes('<OtherTaxBase>91.67</OtherTaxBase>'));assert(xml.includes('<VAT>11.00</VAT>'));assert(xml.includes('TEST &amp; &lt;goods&gt;'));assert(!xml.includes('undefined'));
 assert.throws(()=>renderCoretaxExport({...job.filters,checksum:'altered'}),/checksum/);const listing=await reports.listJobs(user,undefined,undefined,'100');assert.equal(listing.items.find(r=>r.id===job.id).filters,null);
 await enable('tax_export',false);assert.equal((await taxExports.create(request,user)).id,job.id);await assert.rejects(()=>taxExports.create({...request,operationKey:'disabled-export'},user),/belum aktif/);await enable('tax_export');
});

test('BPPU legal review reconciles actual posted Accounting and Tax Core withholding facts',async()=>{
 const code=await prisma.taxCode.create({data:{companyId:user.companyId,code:'TEST-WHT',name:'Synthetic TEST withholding',scope:'WITHHOLDING',version:1,rate:0.02,status:'ACTIVE',payableAccountCode:'2201',calculationRules:{coretax:{bppuObjectCode:'24-104-01'}}}});
 await prisma.accountingPostingRule.create({data:{companyId:user.companyId,code:'TEST-WHT-RULE',name:'Synthetic TEST withholding rule',eventType:'TEST_WITHHOLDING',status:'ACTIVE',journalLines:[{accountCodeKey:'expense',side:'DEBIT',amountKey:'base'},{accountCodeKey:'settlement',side:'CREDIT',amountKey:'paid'},{accountCodeKey:'withholding',side:'CREDIT',amountKey:'tax'}]}});
 await prisma.$transaction(async tx=>{await accounting.postOperationalEvent(tx,{companyId:user.companyId,branchId:user.branchId,eventType:'TEST_WITHHOLDING',sourceType:'SyntheticWithholding',sourceId:'test-wht-source',idempotencyKey:'test-wht-post',amounts:{base:100,paid:98,tax:2},accountCodes:{expense:'5101',settlement:'1102',withholding:'2201'},taxLines:[{taxCodeId:code.id,direction:'WITHHOLDING',taxableBase:100,taxAmount:2}]});});
 // Isolated document fixture ties the reviewed document to the real posted core event.
 const doc=await prisma.taxDocument.create({data:{companyId:user.companyId,branchId:user.branchId,number:'TEST-BPPU',documentType:'BPPU',sourceType:'SyntheticWithholding',sourceId:'test-wht-source',counterpartyName:'Synthetic TEST vendor',counterpartyTaxId:'0000000000000001',netAmount:100,taxAmount:2,grossAmount:98,status:'ISSUED'}});
 const contract='BPPU_2024_11';const facts=(await taxExports.draft(doc.id,contract,user)).facts;assert.equal(facts.rate,'2.00000000');assert.equal(facts.taxCodeVersion,1);
 const mapping={SellerTIN:'0000000000000000',SellerIDTKU:'0000000000000000000000',IDPlaceOfBusinessActivityOfIncomeRecipient:'0000000000000001000000',TaxObjectCode:'24-104-01',Document:'Invoice',GovTreasurerOpt:'No'};
 await assert.rejects(()=>taxExports.approve(doc.id,{operationKey:'wrong-wht-object',contract,mapping:{...mapping,TaxObjectCode:'24-104-02'}},user),/cocok/);
 await taxExports.approve(doc.id,{operationKey:'approve-wht',contract,mapping},user);const result=await taxExports.create({operationKey:'export-wht',contract,documentIds:[doc.id]},user);const job=await prisma.reportJob.findUnique({where:{id:result.id}});assert.match(renderCoretaxExport(job.filters),/<TaxBase>100.00<\/TaxBase>/);
 await prisma.taxDocument.update({where:{id:doc.id},data:{taxAmount:3}});await assert.rejects(()=>taxExports.draft(doc.id,contract,user),/rekonsiliasi/);
});

test('tax snapshot checksum survives PostgreSQL JSONB key reordering while detecting fact and array changes',()=>{
 const snapshot={documents:[{mapping:{SellerTIN:'0000000000000000',goods:{sku:{Opt:'A',Code:'000000',Unit:'UM.0001'}}},facts:{lines:[{net:'100.00',tax:'11.00'},{net:'200.00',tax:'22.00'}]}}],version:1};
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])])):value;
 assert.equal(taxExportChecksum(snapshot),taxExportChecksum(reorder(snapshot)));const altered=structuredClone(snapshot);altered.documents[0].facts.lines[0].tax='12.00';assert.notEqual(taxExportChecksum(snapshot),taxExportChecksum(altered));const reversed=structuredClone(snapshot);reversed.documents[0].facts.lines.reverse();assert.notEqual(taxExportChecksum(snapshot),taxExportChecksum(reversed));
});

test('BPPU separates its contract and versioned object/rate from output VAT and refuses amount injection',()=>{
 assert.throws(()=>validateTaxExportMapping('BPPU_2024_11',{SellerTIN:'0000000000000000',SellerIDTKU:'0000000000000000000000',TaxBase:'100'}),/override/);
 assert.throws(()=>validateTaxExportMapping('FAKTUR_UNKNOWN',{}),/Unsupported/);
 const payload={contract:'BPPU_2024_11',version:1,templateHash:'8a90ea38737bd8d5f0563c12c11ec076b91138f0865ac9f46fd0d4414b004deb',documents:[{mapping:{SellerTIN:'0000000000000000',SellerIDTKU:'0000000000000000000000',IDPlaceOfBusinessActivityOfIncomeRecipient:'0000000000000001000000',TaxObjectCode:'24-104-01',Document:'Invoice',GovTreasurerOpt:'No'},facts:{date:'2026-10-06',number:'SYNTHETIC-TEST',buyerTin:'0000000000000001',buyerName:'TEST',net:'100.00',rate:'2.00000000'}}]};
 const xml=renderCoretaxExport({...payload,checksum:taxExportChecksum(payload)});assert(xml.includes('<BpuBulk>'));assert(xml.includes('<Rate>2.00000000</Rate>'));assert(!xml.includes('<TaxInvoice>'));
});

test('P6D canonical journals remain balanced and order cash never duplicates a Sale',async()=>{
 const journals=await prisma.journalEntry.findMany({include:{lines:true}});for(const row of journals)assert.equal(row.lines.reduce((sum,line)=>sum+Number(line.debit)-Number(line.credit),0),0);assert.equal(await prisma.sale.count(),1);
});

test('posted tax period and export date follow the trusted company calendar across local month boundaries',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-01-31T17:10:00Z')});
 const originalZone=(await prisma.company.findUnique({where:{id:user.companyId}})).timezone;
 t.after(async()=>{t.mock.timers.reset();await prisma.company.update({where:{id:user.companyId},data:{timezone:originalZone}});});
 await prisma.company.update({where:{id:user.companyId},data:{timezone:'Asia/Makassar'}});
 const c=await customer('calendar');await prisma.customer.update({where:{id:c.id},data:{taxIdNumber:'0000000000000001'}});
 const code=await prisma.taxCode.create({data:{companyId:user.companyId,code:'VAT-CALENDAR',name:'Synthetic TEST VAT calendar',scope:'SALE',rate:'0.11',status:'ACTIVE',calculationRules:{coretax:{vatRatePercent:'12',otherTaxBaseNumerator:'11',otherTaxBaseDenominator:'12'}}}});
 const item=await product('calendar',100);await prisma.product.update({where:{id:item.id},data:{salesTaxCodeId:code.id}});
 let firstDocument;
 for(const [zone,period,date] of [['Asia/Makassar','2026-02','2026-02-01'],['UTC','2026-01','2026-01-31']]) {
  await prisma.company.update({where:{id:user.companyId},data:{timezone:zone}});
  const sale=await sales.create({warehouseId:'p6d-wh',customerId:c.id,paymentMethod:'CASH',idempotencyKey:`calendar-${zone}`,items:[{productId:item.id,quantity:1}]},user);
  const document=await prisma.taxDocument.findUnique({where:{id:sale.taxDocumentId}});assert.equal(document.taxPeriod,period);
  const rows=await prisma.taxTransaction.findMany({where:{sourceType:'Sale',sourceId:sale.id}});assert(rows.length);assert(rows.every(row=>row.taxPeriod===period));
  assert.equal((await taxExports.draft(document.id,'FAKTUR_PK_1_4',user)).facts.date,date);
  if (!firstDocument) firstDocument=document;
 }
 await assert.rejects(()=>taxExports.draft(firstDocument.id,'FAKTUR_PK_1_4',user),/Periode pajak historis/);
 assert.equal((await prisma.taxDocument.findUnique({where:{id:firstDocument.id}})).taxPeriod,'2026-02');
 const count=await prisma.sale.count();const journalCount=await prisma.journalEntry.count();
 await prisma.company.update({where:{id:user.companyId},data:{timezone:'Invalid/TEST'}});
 await assert.rejects(()=>sales.create({warehouseId:'p6d-wh',customerId:c.id,paymentMethod:'CASH',idempotencyKey:'calendar-invalid',items:[{productId:item.id,quantity:1}]},user),/Timezone company tidak valid/);
 assert.equal(await prisma.sale.count(),count);assert.equal(await prisma.journalEntry.count(),journalCount);
});
