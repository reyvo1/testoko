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
const dir = mkdtempSync(path.join(os.tmpdir(), 't360-p6c-'));
const url = `file:${path.join(dir, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const opts = { platform: 'node', external: ['@toko360/contracts/customer-communications.cjs', '@prisma/client', '@nestjs/microservices', '@nestjs/websockets', '@nestjs/websockets/socket-module'] };
const imported = {};
for (const [name,file] of Object.entries({ SalesService:'sales/sales.service', ReturnsService:'returns/returns.service', ExchangesService:'returns/exchanges.service', FinanceOperationsService:'finance-operations/finance-operations.service', CustomerCommunicationsService:'storefront-customer/customer-communications.service', StorefrontCustomerService:'storefront-customer/storefront-customer.service', ReceiptController:'sales/receipt.controller', AccountingCoreService:'accounting-core/accounting-core.service', OperationsControlService:'operations-control/operations-control.service', PromotionsService:'promotions/promotions.service', StockAlertService:'sales/stock-alert.service', SupervisorApprovalService:'supervisor-approval/supervisor-approval.service', ProductsService:'products/products.service' })) imported[name] = (await load(`apps/api/src/${file}.ts`, opts))[name];
const { mintReceiptShare, verifyReceiptShare } = await load('apps/api/src/common/receipt-access.ts', opts);
const config = { get: (key) => ({ JWT_SECRET:'synthetic-p6c-signing-key-not-production-0000', STOREFRONT_PUBLIC_URL:'http://localhost:3000', PUBLIC_API_URL:'http://localhost:4000/api/v1', NODE_ENV:'test' })[key] };
const user = { sub:'p6c-user', companyId:'p6c-company', branchId:'p6c-branch', roles:['ADMIN'], permissions:['sale.create','sale.view','sale.return','sale.refund','finance.create','finance.approve','finance.post','notification.manage'] };
const accounting = new imported.AccountingCoreService(prisma);
const alerts = new imported.StockAlertService(prisma);
const sales = new imported.SalesService(prisma, accounting, alerts, new imported.PromotionsService(prisma), new imported.SupervisorApprovalService(prisma));
const returns = new imported.ReturnsService(prisma, accounting, new imported.OperationsControlService(prisma), null);
const exchanges = new imported.ExchangesService(prisma, returns, sales, alerts);
const finance = new imported.FinanceOperationsService(prisma, accounting);
const customers = new imported.StorefrontCustomerService(prisma, config);
const communications = new imported.CustomerCommunicationsService(prisma, customers, config);
const receipts = new imported.ReceiptController(prisma, config);
const products = new imported.ProductsService(prisma);
let sequence = 0;

async function enable(key, enabled = true, settings = {}) {
  const row = await prisma.featureFlag.findFirst({ where: { companyId:user.companyId, branchId:user.branchId, userId:null, key } });
  const data = { enabled, config:settings };
  return row ? prisma.featureFlag.update({where:{id:row.id},data}) : prisma.featureFlag.create({data:{companyId:user.companyId,branchId:user.branchId,key,scope:'BRANCH',...data}});
}
async function customer(tag, verified = true) {
  const id = `p6c-customer-${tag}`; const token = `synthetic-p6c-session-${tag}-not-production`;
  await prisma.customer.create({data:{id,companyId:user.companyId,name:'Synthetic TEST customer',email:`${tag}@example.invalid`,phone:`+620000${++sequence}`,emailVerifiedAt:verified?new Date():null,phoneVerifiedAt:verified?new Date():null,account:{create:{passwordHash:'synthetic-fixture-only'}}}});
  await prisma.customerSession.create({data:{customerId:id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  return { id, token };
}
async function product(tag, price = 60, stock = 30) {
  const row = await products.create({sku:`p6c-${tag}`,name:`TEST ${tag}`,unit:'UNIT',costPrice:10,salePrice:price},user);
  if(stock) await prisma.inventory.create({data:{warehouseId:'p6c-wh',productId:row.id,quantity:stock,available:stock}}); // Isolated synthetic TEST bootstrap only.
  return row;
}
async function quantity(id) { return (await prisma.inventory.findUnique({where:{warehouseId_productId:{warehouseId:'p6c-wh',productId:id}}}))?.quantity??0; }
async function originalReturn(tag, price = 25) {
  const item = await product(tag,price);
  const sale = await sales.create({warehouseId:'p6c-wh',paymentMethod:'CASH',idempotencyKey:`original-${tag}`,items:[{productId:item.id,quantity:1}]},user);
  const returned = await returns.createSaleReturn({saleId:sale.id,warehouseId:'p6c-wh',refundMethod:'ORIGINAL',items:[{saleItemId:sale.items[0].id,quantity:1}]},user);
  return { item, sale, returned };
}
async function passInspection(id) { await prisma.operationalInspection.update({where:{id},data:{status:'PASSED'}}); } // Inspector fixture; real API inspection is required separately in PostgreSQL UAT.
async function credit(customerId, amount, tag) {
  const row = await finance.createCustomerDeposit({customerId,amount,kind:'CREDIT',settlementAccountCode:'1101',operationKey:tag},user);
  await assert.rejects(()=>finance.post(row.id,user),/status|disetujui/i);
  await finance.approve(row.id,{},user); await finance.post(row.id,user); return row;
}
function depositSale(item, customerId, tag) { return {warehouseId:'p6c-wh',customerId,paymentMethod:'DEPOSIT',idempotencyKey:tag,items:[{productId:item.id,quantity:1}]}; }

before(async()=>{
  writeFileSync(path.join(dir,'test.db'),'');
  execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',path.join(root,'apps/api/prisma/schema.sqlite.prisma')],{cwd:root,env:{...process.env,DATABASE_URL:url,RUST_LOG:'info'},stdio:'pipe'});
  await prisma.company.create({data:{id:user.companyId,name:'TEST P6C',slug:'p6c-test'}});
  await prisma.branch.create({data:{id:user.branchId,companyId:user.companyId,code:'P6C',name:'TEST'}});
  await prisma.user.create({data:{id:user.sub,branchId:user.branchId,name:'Synthetic TEST operator',email:'p6c-operator@example.invalid',passwordHash:'synthetic-fixture-only'}});
  await prisma.warehouse.create({data:{id:'p6c-wh',branchId:user.branchId,code:'P6C',name:'TEST',isDefault:true}});
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'UNIT',code:'UNIT',name:'Unit'}});
  await prisma.masterReference.create({data:{companyId:user.companyId,type:'PAYMENT_METHOD',code:'CASH',name:'Kas'}});
  await prisma.masterReference.create({data:{companyId:user.companyId,branchId:user.branchId,type:'PAYMENT_METHOD',code:'DEPOSIT',name:'Deposit',metadata:{kind:'DEPOSIT',settlementAccountCode:'2302',settlementBehavior:'IMMEDIATE',refundBehavior:'ORIGINAL',allowOffline:false,allowCashChange:false,requiresProvider:false,requiresReference:false,feeRatePercent:0}}});
  for(const [code,type] of [['1101','ASSET'],['1102','ASSET'],['1301','ASSET'],['4101','REVENUE'],['4102','REVENUE'],['5101','EXPENSE'],['2201','LIABILITY'],['2302','LIABILITY']]) await prisma.account.create({data:{branchId:user.branchId,code,name:code,type}});
  for(const [eventType,journalLines] of [
    ['SALE_CASH',[{accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement'},{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['SALE_BANK',[{accountCodeKey:'settlement',side:'DEBIT',amountKey:'settlement'},{accountCodeKey:'revenue',side:'CREDIT',amountKey:'revenue'},{accountCodeKey:'cogs',side:'DEBIT',amountKey:'cogs'},{accountCodeKey:'inventory',side:'CREDIT',amountKey:'inventory'}]],
    ['SALE_RETURN',[{accountCodeKey:'returns',side:'DEBIT',amountKey:'net'},{accountCodeKey:'inventory',side:'DEBIT',amountKey:'inventory',skipIfZero:true},{accountCodeKey:'cogs',side:'CREDIT',amountKey:'cogs',skipIfZero:true}]],
    ['BALANCE_TRANSFER',[{accountCodeKey:'debit',side:'DEBIT',amountKey:'gross'},{accountCodeKey:'credit',side:'CREDIT',amountKey:'gross'}]],
  ]) await prisma.accountingPostingRule.create({data:{companyId:user.companyId,code:eventType,name:eventType,eventType,status:'ACTIVE',journalLines}});
  await enable('retail_exchange'); await enable('customer_deposit',true,{accountCode:'2302'}); await enable('customer_campaign');
  await sales.openShift(user,1000);
});
after(async()=>{await prisma.$disconnect();rmSync(dir,{recursive:true,force:true});});

test('exchange refuses unapproved inspection and altered difference with complete transaction rollback',async()=>{
  const fixture=await originalReturn('rollback');const shift=await sales.currentShift(user);
  const dto={operationKey:'exchange-rollback',saleReturnId:fixture.returned.id,cashierShiftId:shift.id,expectedDifference:0,replacement:{warehouseId:'p6c-wh',items:[{productId:fixture.item.id,quantity:1}]},confirmation:{}};
  await assert.rejects(()=>exchanges.create(dto,user),/Pemeriksaan/);
  await passInspection(fixture.returned.inspectionId);
  const before={quantity:await quantity(fixture.item.id),journals:await prisma.journalEntry.count(),movements:await prisma.inventoryMovement.count(),sales:await prisma.sale.count()};
  await assert.rejects(()=>exchanges.create({...dto,expectedDifference:1},user),/Selisih/);
  assert.equal((await prisma.saleReturn.findUnique({where:{id:fixture.returned.id}})).status,'REQUESTED');
  assert.deepEqual({quantity:await quantity(fixture.item.id),journals:await prisma.journalEntry.count(),movements:await prisma.inventoryMovement.count(),sales:await prisma.sale.count()},before);
  const result=await exchanges.create(dto,user);assert.equal(Number(result.difference),0);assert.equal((await exchanges.create(dto,user)).id,result.id);
  await assert.rejects(()=>exchanges.create({...dto,expectedDifference:2},user),/payload berbeda/);
});

test('exchange cash difference posts canonical gross journals and current-shift recap, without duplicate stock',async()=>{
  const fixture=await originalReturn('difference',25);const replacement=await product('replacement',40);await passInspection(fixture.returned.inspectionId);
  const shift=await sales.currentShift(user);const before=(await sales.shiftRecap(user,shift.id));
  const dto={operationKey:'exchange-difference',saleReturnId:fixture.returned.id,cashierShiftId:shift.id,expectedDifference:15,replacement:{warehouseId:'p6c-wh',items:[{productId:replacement.id,quantity:1}]},confirmation:{}};
  const results=await Promise.all([exchanges.create(dto,user),exchanges.create(dto,user)]);assert.equal(results[0].id,results[1].id);
  assert.equal(await quantity(fixture.item.id),30);assert.equal(await quantity(replacement.id),29);
  const after=(await sales.shiftRecap(user,shift.id));
  const liveCash = (recap) => { const f = recap.expectedCashFormula; return f.openingCash + f.cashSales + f.cashIn - f.cashOut - f.cashRefunds; };
  assert.equal(liveCash(after)-liveCash(before),15);
  await assert.rejects(()=>exchanges.create({...dto,operationKey:'different-key'},user),/sudah ditukar|berstatus|belum tersedia/i);
});

test('exchange rejects authority, foreign branch and insufficient replacement stock without posting return',async()=>{
  const fixture=await originalReturn('denials');await passInspection(fixture.returned.inspectionId);const shift=await sales.currentShift(user);
  const dto={operationKey:'exchange-denials',saleReturnId:fixture.returned.id,cashierShiftId:shift.id,expectedDifference:475,replacement:{warehouseId:'p6c-wh',items:[{productId:fixture.item.id,quantity:20}]},confirmation:{}};
  await assert.rejects(()=>exchanges.create(dto,{...user,roles:['CASHIER']}),/Izin/);
  await assert.rejects(()=>exchanges.create(dto,{...user,branchId:'foreign'}),/Retur|cabang/i);
  dto.replacement.items[0].quantity=100;
  await assert.rejects(()=>exchanges.create(dto,user),/Stok|stok/);
  assert.equal((await prisma.saleReturn.findUnique({where:{id:fixture.returned.id}})).status,'REQUESTED');assert.equal(await quantity(fixture.item.id),29);
});

test('deposit approval, exact receipt replay, liability aggregation and held refund prevent spending twice',async()=>{
  const c=await customer('deposit');const row=await credit(c.id,100,'deposit-credit');
  assert.equal((await finance.createCustomerDeposit({customerId:c.id,amount:100,kind:'CREDIT',settlementAccountCode:'1101',operationKey:'deposit-credit'},user)).id,row.id);
  assert.equal((await finance.post(row.id,user)).id,row.id);
  const hold=await finance.createCustomerDeposit({customerId:c.id,amount:30,kind:'REFUND',settlementAccountCode:'1101',depositAccountCode:'2302',operationKey:'deposit-hold'},user);
  assert.equal((await finance.depositBalance(user,c.id)).available,'70.00');
  const expensive=await product('deposit-too-much',80);await assert.rejects(()=>sales.create(depositSale(expensive,c.id,'deposit-denied'),user),/Saldo deposit/);
  const item=await product('deposit-consume',60);const sale=await sales.create(depositSale(item,c.id,'deposit-consume'),user);
  assert.equal((await sales.create(depositSale(item,c.id,'deposit-consume'),user)).id,sale.id);
  assert.equal((await finance.depositBalance(user,c.id)).available,'10.00');
  await finance.approve(hold.id,{},user);await finance.post(hold.id,user);assert.equal((await finance.depositBalance(user,c.id)).posted,'10.00');
  const other=await customer('deposit-other');await assert.rejects(()=>finance.createCustomerDeposit({customerId:other.id,amount:100,kind:'CREDIT',settlementAccountCode:'1101',operationKey:'deposit-credit'},user),/payload berbeda/);
  await assert.rejects(()=>finance.create({type:'OTHER',description:'Bypass deposit',amount:1,debitAccountCode:'1101',creditAccountCode:'2302',idempotencyKey:'bypass'},user),/al ur|alur|deposit/);
});

test('concurrent deposit consumption cannot overdraw canonical liability and original return restores it with ingress disabled',async()=>{
  const c=await customer('parallel');await credit(c.id,100,'parallel-credit');const item=await product('parallel-item',60);
  const results=await Promise.allSettled(['left','right'].map(tag=>sales.create(depositSale(item,c.id,`deposit-parallel-${tag}`),user)));
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal((await finance.depositBalance(user,c.id)).available,'40.00');
  const sale=results.find(row=>row.status==='fulfilled').value;const returned=await returns.createSaleReturn({saleId:sale.id,warehouseId:'p6c-wh',refundMethod:'ORIGINAL',items:[{saleItemId:sale.items[0].id,quantity:1}]},user);await passInspection(returned.inspectionId);
  await enable('customer_deposit',false,{accountCode:'2302'});
  const tender=await prisma.masterReference.findFirst({where:{companyId:user.companyId,type:'PAYMENT_METHOD',code:'DEPOSIT'}});await prisma.masterReference.update({where:{id:tender.id},data:{metadata:{kind:'SETTLEMENT',settlementAccountCode:'1102',allowOffline:false,allowCashChange:false}}});
  const restored=await returns.confirmSaleReturn(returned.id,{},user);assert.equal(restored.refundDetails[0].kind,'DEPOSIT');assert.equal(restored.refundDetails[0].accountCode,'2302');assert.equal((await finance.depositBalance(user,c.id,'2302')).available,'100.00');
  await enable('customer_deposit',true,{accountCode:'2302'});
});

test('customer-only consent rejects unverified contact, separates marketing from receipts and rechecks changed contact',async()=>{
  const c=await customer('consent');const dto={operationKey:'consent-on',marketingEmail:true,marketingWhatsapp:false,receiptEmail:false,receiptWhatsapp:false};
  await communications.savePreferences(dto,'P6C',c.token);await communications.savePreferences(dto,'P6C',c.token);
  assert.equal((await communications.preferences('P6C',c.token)).receiptEmail,false);
  const unverified=await customer('unverified',false);await assert.rejects(()=>communications.savePreferences({...dto,operationKey:'unverified'},'P6C',unverified.token),/Verifikasi/);
  await assert.rejects(()=>communications.savePreferences({...dto,marketingEmail:false},'P6C',c.token),/payload berbeda/);
  const notification={companyId:user.companyId,channel:'EMAIL',recipient:'consent@example.invalid',data:{customerCommunication:1,purpose:'RECEIPT',branchId:user.branchId,customerId:c.id}};
  assert.equal(await customerNotificationAllowed(prisma,notification),false);
  await communications.savePreferences({...dto,operationKey:'receipt-on',receiptEmail:true},'P6C',c.token);assert.equal(await customerNotificationAllowed(prisma,notification),true);
  await prisma.customer.update({where:{id:c.id},data:{email:'new-contact@example.invalid',emailVerifiedAt:new Date()}});notification.recipient='new-contact@example.invalid';assert.equal(await customerNotificationAllowed(prisma,notification),false);
});

test('campaign worker batches at 100, snapshots template, deduplicates and honors revoke/cancel before transport',async()=>{
  const first=await customer('campaign-a');const second=await customer('campaign-b');
  for(const c of [first,second]) await communications.savePreferences({operationKey:`opt-${c.id}`,marketingEmail:true,marketingWhatsapp:false,receiptEmail:false,receiptWhatsapp:false},'P6C',c.token);
  await prisma.customer.createMany({data:Array.from({length:101},(_,i)=>({id:`p6c-unsubscribed-${i}`,companyId:user.companyId,name:'Synthetic no-consent account'}))});
  await prisma.notificationTemplate.create({data:{companyId:user.companyId,channel:'EMAIL',code:'P6C-CAMPAIGN',body:'Synthetic campaign fixture',subject:'TEST'}});
  const dto={operationKey:'campaign-create',channel:'EMAIL',templateCode:'P6C-CAMPAIGN'};const campaign=await communications.createCampaign(dto,user);assert.equal((await communications.createCampaign(dto,user)).id,campaign.id);
  const firstJob=await prisma.automationJob.findFirst({where:{sourceId:campaign.id}});
  await prisma.$transaction(tx=>processCustomerCampaignBatch(tx,firstJob));await prisma.$transaction(tx=>processCustomerCampaignBatch(tx,firstJob));
  let jobs=await prisma.automationJob.findMany({where:{sourceId:campaign.id},orderBy:{createdAt:'asc'}});assert(jobs.length>=2);
  for(const job of jobs.slice(1)) await prisma.$transaction(tx=>processCustomerCampaignBatch(tx,job));
  const deliveries=await prisma.customerCampaignDelivery.findMany({where:{campaignId:campaign.id}});assert.equal(deliveries.length,2);
  const queued=await prisma.notification.findMany({where:{id:{in:deliveries.map(row=>row.notificationId)}}});assert(queued.every(row=>row.body==='Synthetic campaign fixture'));
  const selected=queued.find(row=>row.recipient==='campaign-a@example.invalid');assert.equal(await customerNotificationAllowed(prisma,selected),true);
  await communications.savePreferences({operationKey:'campaign-opt-out',marketingEmail:false,marketingWhatsapp:false,receiptEmail:false,receiptWhatsapp:false},'P6C',first.token);assert.equal(await customerNotificationAllowed(prisma,selected),false);
  await communications.cancelCampaign(campaign.id,{operationKey:'cancel-campaign'},user);assert.equal(await customerNotificationAllowed(prisma,queued.find(row=>row.id!==selected.id)),false);
  await assert.rejects(()=>communications.campaignDeliveries(campaign.id,{...user,branchId:'foreign'}),/tidak tersedia/);
});

test('receipt signature binds company branch sale and expiry; bare/altered links and foreign ownership fail closed',async()=>{
  const c=await customer('receipt-owner');const other=await customer('receipt-other');const item=await product('receipt-item',25);
  const sale=await sales.create({warehouseId:'p6c-wh',customerId:c.id,paymentMethod:'CASH',idempotencyKey:'receipt-sale',items:[{productId:item.id,quantity:1}]},user);
  const link=await receipts.share(sale.number,user);const token=new URL(`http://test.invalid${link.path}`).searchParams.get('share');
  const html=await receipts.receipt(sale.number,token);assert(html.includes(sale.number));assert(!html.includes('unitCost'));
  await assert.rejects(()=>receipts.receipt(sale.number),/tidak tersedia/);await assert.rejects(()=>receipts.receipt(sale.number,token+'x'),/tidak tersedia/);
  assert.equal(verifyReceiptShare(token,sale.number,config.get('JWT_SECRET'),Date.now()+3601000),null);
  assert.equal(verifyReceiptShare(token,'another-sale',config.get('JWT_SECRET')),null);
  await assert.rejects(()=>receipts.share(sale.number,{...user,branchId:'foreign'}),/tidak tersedia/);
  await assert.rejects(()=>communications.customerReceiptLink(sale.number,'P6C',other.token),/tidak tersedia/);
  const own=await communications.receipts('P6C',c.token,'1');assert.equal(own.items[0].id,sale.id);assert.equal(own.items.length,1);
  await communications.savePreferences({operationKey:'receipt-consent',marketingEmail:false,marketingWhatsapp:false,receiptEmail:true,receiptWhatsapp:false},'P6C',c.token);
  const dto={operationKey:'receipt-queue',channel:'EMAIL'};const notification=await communications.queueReceipt(sale.id,dto,user);assert.equal((await communications.queueReceipt(sale.id,dto,user)).id,notification.id);
  const stored=await prisma.notification.findUnique({where:{id:notification.id}});assert(stored.body.includes('/account'));assert(!stored.body.includes('?share='));assert(!stored.body.includes('25'));
  assert.throws(()=>mintReceiptShare(sale,user.companyId,'short'),/Kunci/);
});

test('manual rules with literal deposit liability cannot bypass customer attribution',async()=>{
 await prisma.accountingPostingRule.create({data:{companyId:user.companyId,code:'DEPOSIT_BYPASS',name:'TEST bypass',eventType:'DEPOSIT_BYPASS',status:'ACTIVE',journalLines:[{accountCode:'1101',side:'DEBIT',amountKey:'gross'},{accountCode:'2302',side:'CREDIT',amountKey:'gross'}]}});
 const count=await prisma.journalEntry.count();await assert.rejects(()=>accounting.postManual({eventType:'DEPOSIT_BYPASS',sourceType:'Manual',sourceId:'synthetic-bypass',idempotencyKey:'literal-bypass',amounts:{gross:1}},user),/deposit/);assert.equal(await prisma.journalEntry.count(),count);
});

test('deposit customer lookup pages actual owned customer records and rejects foreign/unauthorized access',async()=>{
 const first=await finance.depositCustomers(user,'1');assert.equal(first.items.length,1);assert(first.pageInfo.nextCursor);const second=await finance.depositCustomers(user,'1',first.pageInfo.nextCursor);assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);assert.deepEqual(Object.keys(first.items[0]).sort(),['createdAt','id','name']);
 assert.equal((await finance.depositCustomers({...user,companyId:'foreign'},'1')).items.length,0);await assert.rejects(()=>finance.depositCustomers({...user,permissions:['sale.view']},'1'),/Izin/);
});

test('deposit tender branch-only edits cannot make it global or move it to a different liability configuration',async()=>{
 const {MasterDataService}=await load('apps/api/src/master-data/master-data.service.ts',opts);const master=new MasterDataService(prisma);
 let tender=await prisma.masterReference.findFirst({where:{companyId:user.companyId,branchId:user.branchId,type:'PAYMENT_METHOD',code:'DEPOSIT'}});
 // The historical-refund scenario intentionally changed this tender into SETTLEMENT.
 // Restore an actual DEPOSIT policy before exercising branch-only configuration edits.
 tender=await master.updateReference(tender.id,{metadata:{kind:'DEPOSIT',settlementAccountCode:'2302',settlementBehavior:'IMMEDIATE',refundBehavior:'ORIGINAL',allowOffline:false,allowCashChange:false,requiresProvider:false,requiresReference:false,feeRatePercent:0}},user);
 await prisma.branch.create({data:{id:'p6c-deposit-other-branch',companyId:user.companyId,code:'P6COTHER',name:'Synthetic TEST'}});
 await prisma.account.create({data:{branchId:'p6c-deposit-other-branch',code:'2303',name:'Synthetic TEST other deposit',type:'LIABILITY'}});
 await prisma.featureFlag.create({data:{companyId:user.companyId,branchId:'p6c-deposit-other-branch',key:'customer_deposit',scope:'BRANCH',enabled:true,config:{accountCode:'2303'}}});
 await assert.rejects(()=>master.updateReference(tender.id,{branchId:null},user),/satu cabang/);
 await assert.rejects(()=>master.updateReference(tender.id,{branchId:'p6c-deposit-other-branch'},user),/cocok/);
 const retained=await prisma.masterReference.findUnique({where:{id:tender.id}});assert.equal(retained.branchId,user.branchId);assert.deepEqual(retained.metadata,tender.metadata);
 const renamed=await master.updateReference(tender.id,{name:'Deposit pelanggan'},user);assert.equal(renamed.name,'Deposit pelanggan');assert.equal(renamed.branchId,user.branchId);
});

test('all canonical retail journal entries balance and deposit cash links reach shift metrics once',async()=>{
  const journals=await prisma.journalEntry.findMany({include:{lines:true}});assert(journals.length>5);
  for(const journal of journals) assert.equal(journal.lines.reduce((sum,line)=>sum+Number(line.debit)-Number(line.credit),0),0);
  const shift=await sales.currentShift(user);const recap=await sales.shiftRecap(user,shift.id);assert(Number(recap.cashMovements.cashIn)>=200);assert(Number(recap.cashMovements.cashOut)>=30);
  const linked=await prisma.operationalFinanceTransaction.count({where:{depositCashierShiftId:shift.id,status:'POSTED'}});assert(linked>=3);
});
