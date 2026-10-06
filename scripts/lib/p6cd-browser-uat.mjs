// Executes real operator controls against the explicitly non-production Browser UAT runtime.
// Synthetic customer only. Credentials/session/OTP/share tokens stay in memory, never evidence.
export async function runP6cdBrowserUat({cdp,apiUrl,adminUrl,posUrl,storefrontUrl,token,unit,branchId,branchCode,evidence,http,evaluateValue,waitExpression,navigateAdminContext,assertResponsiveMatrix,captureSuccessScreenshot:captureScreenshot,ensureStockThroughReceiving}) {
  const stamp=`${Date.now()}-${process.pid}`;const headers={authorization:`Bearer ${token}`};
  async function captureSuccessScreenshot(session,name) {const desktop=await captureScreenshot(session,name);try {await session.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await new Promise(resolve=>setTimeout(resolve,150));await captureScreenshot(session,`${name}-mobile`);}finally {await session.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});}return desktop;}
  async function api(path,{method='GET',body,customerHeaders}={}) {const response=await http(`${apiUrl}${path}`,{method,headers:{...headers,...customerHeaders,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}if(!response.ok)throw new Error(`P6CD ${method} ${path} HTTP ${response.status} [private response omitted]`);return data;}
  async function click(text,scope='document') {await waitExpression(cdp,`(()=>{const root=${scope};return Boolean(root&&[...root.querySelectorAll('button')].some(node=>node.textContent?.trim()===${JSON.stringify(text)}&&!node.disabled));})()`,`P6CD enabled operator button: ${text}`);const ok=await evaluateValue(cdp,`(()=>{const root=${scope};const button=[...root.querySelectorAll('button')].find(node=>node.textContent?.trim()===${JSON.stringify(text)});if(!button||button.disabled)return false;button.click();return true;})()`,{userGesture:true});if(!ok)throw new Error(`P6CD operator button unavailable: ${text}`);}
  async function field(label,value,scope='document') {const ok=await evaluateValue(cdp,`(()=>{const root=${scope};const label=[...root.querySelectorAll('label')].find(node=>node.textContent?.trim().startsWith(${JSON.stringify(label)}));const input=label?.querySelector('input,select,textarea');if(!input)return false;const prototype=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);if(!ok)throw new Error(`P6CD operator field unavailable: ${label}`);}
  const flags=await api('/platform/features');
  const depositCode=`UATDEP${String(Date.now()).slice(-9)}`;
  await api('/accounting-core/accounts',{method:'POST',body:{code:depositCode,name:'Synthetic Browser TEST deposit',type:'LIABILITY'}});
  for(const key of ['retail_exchange','customer_deposit','customer_campaign','pos_ship_later','tax_export'])await api('/platform/features',{method:'POST',body:{key,branchId,enabled:true,config:key==='customer_deposit'?{accountCode:depositCode}:{}}});
  const registration=await api('/storefront/account/register',{method:'POST',body:{branchCode,name:`P6CD Browser ${stamp}`,email:`p6cd-browser-${stamp}@example.invalid`,password:'Synthetic-TEST-only-browser!0000',address:'Synthetic TEST customer address'}});
  const customerHeaders={'x-branch-code':branchCode,'x-customer-session':registration.sessionToken};
  const verification=await api('/storefront/account/verification/request',{method:'POST',customerHeaders,body:{type:'EMAIL'}});
  if(!verification.debugCode)throw new Error('P6CD Browser TEST requires CUSTOMER_VERIFICATION_DEBUG_CODE=true on non-production API.');
  await api('/storefront/account/verification/confirm',{method:'POST',customerHeaders,body:{type:'EMAIL',code:verification.debugCode}});
  const customerId=registration.customer.id;
  await api(`/master-data/customers/${customerId}`,{method:'PATCH',body:{taxIdNumber:'0000000000000001'}});
  const warehouses=await api('/inventory/warehouses');const warehouse=warehouses.find(row=>row.branchId===branchId&&row.isDefault)??warehouses.find(row=>row.branchId===branchId);if(!warehouse)throw new Error('P6CD Browser warehouse missing.');
  const product=await api('/products',{method:'POST',body:{sku:`P6CD-BROWSER-${stamp}`,name:`P6CD Browser goods ${stamp}`,unit,costPrice:10,salePrice:50}});
  await ensureStockThroughReceiving(apiUrl,headers,{product,warehouse,quantity:5});
  // Customer-owned checkbox save, with real contact verification and exact persisted preferences.
  await cdp.call('Page.navigate',{url:storefrontUrl});
  await waitExpression(cdp,`document.readyState==='complete'`,'P6CD storefront ready');
  await evaluateValue(cdp,`localStorage.setItem('toko360.customer.session',${JSON.stringify(registration.sessionToken)});localStorage.setItem('toko360.storefront.branch',${JSON.stringify(branchCode)});location.href='/account';true`);
  await waitExpression(cdp,`Boolean(document.querySelector('.customerCommunications form input[type="checkbox"]'))`,'P6CD customer preference controls',45000);
  await evaluateValue(cdp,`(()=>{const input=document.querySelector('.customerCommunications form input[type="checkbox"]');if(input.disabled)throw new Error('Verified customer marketing checkbox disabled');if(!input.checked)input.click();return true;})()`);
  await click('Simpan pilihan komunikasi');
  await waitExpression(cdp,`document.querySelector('.customerCommunications')?.textContent.includes('Pilihan komunikasi tersimpan')`,'P6CD customer consent save');
  const preferences=await api('/storefront/account/communication-preferences',{customerHeaders});if(!preferences.marketingEmail||preferences.receiptEmail)throw new Error('P6CD preference UI did not keep separate marketing/receipt purpose.');
  evidence.checks.push({id:'P6CD_CUSTOMER_CONSENT_BROWSER',status:'PASS',actualVerificationApi:true,productionProviderCertification:'PENDING',matrix:await assertResponsiveMatrix(cdp,'P6CD customer communications'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-customer-communications')});
  // Canonical finance receipt controls: draft -> approval -> post; ledger result is checked via API.
  let shift=await api('/sales/shifts/current');if(!shift)shift=await api('/sales/shifts/open',{method:'POST',body:{openingCash:0}});
  await navigateAdminContext(cdp,'/finance/receivables','P6CD deposit operator');
  await waitExpression(cdp,`document.body.innerText.includes('Buat dokumen deposit') && [...document.querySelectorAll('select option')].some(node=>node.value===${JSON.stringify(customerId)})`,'P6CD deposit customer lookup');
  const depositPanel=`[...document.querySelectorAll('.panel')].find(node=>node.textContent.includes('Deposit pelanggan'))`;
  await field('Pelanggan',customerId,depositPanel);await field('Jumlah',150,depositPanel);await field('Kode akun kas/bank tender','1101',depositPanel);
  await click('Buat dokumen deposit',depositPanel);
  await waitExpression(cdp,`document.body.innerText.includes('Setujui deposit')`,'P6CD deposit approval control');await click('Setujui deposit',depositPanel);
  await waitExpression(cdp,`document.body.innerText.includes('Posting deposit')`,'P6CD deposit posting control');await click('Posting deposit',depositPanel);
  await waitExpression(cdp,`document.body.innerText.includes('Deposit telah diposting')`,'P6CD deposit posting confirmation');
  const balance=await api(`/finance-operations/customer-deposits/${customerId}/balance`);if(balance.available!=='150.00')throw new Error('P6CD deposit UI did not post exact liability amount.');
  evidence.checks.push({id:'P6CD_DEPOSIT_APPROVE_POST_BROWSER',status:'PASS',available:'150.00',matrix:await assertResponsiveMatrix(cdp,'P6CD deposit'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-deposit')});
  // Campaign create/cancel controls use the canonical worker job and current consent gate.
  const templateCode=`BROWSER${String(Date.now()).slice(-9)}`;await api('/notifications/templates',{method:'POST',body:{code:templateCode,channel:'EMAIL',subject:'Synthetic TEST campaign',body:'Synthetic TEST campaign body',isActive:true}});
  await navigateAdminContext(cdp,'/integrations/notifications','P6CD campaign operator');
  await waitExpression(cdp,`document.body.innerText.includes('Antrekan campaign') && [...document.querySelectorAll('select option')].some(node=>node.textContent.includes(${JSON.stringify(templateCode)}))`,'P6CD campaign template controls');
  const template=await api('/notifications/templates');const selected=template.find(row=>row.code===templateCode);
  const campaignPanel=`[...document.querySelectorAll('.panel')].find(node=>node.textContent.includes('Campaign dengan persetujuan'))`;
  await field('Template marketing',selected.id,campaignPanel);await click('Antrekan campaign',campaignPanel);await waitExpression(cdp,`document.body.innerText.includes('Campaign masuk antrean')`,'P6CD campaign enqueue');
  await click('Batalkan',`[...(${campaignPanel}).querySelectorAll('.tr:not(.th)')].find(node=>node.textContent.includes(${JSON.stringify(templateCode)}))`);await waitExpression(cdp,`document.body.innerText.includes('Campaign dibatalkan')`,'P6CD campaign cancellation');
  evidence.checks.push({id:'P6CD_CAMPAIGN_CREATE_CANCEL_BROWSER',status:'PASS',matrix:await assertResponsiveMatrix(cdp,'P6CD campaign'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-campaign')});
  // Ship-later from the POS cart. The regular sale controls lock while its Order reserves stock.
  const couriers=await api('/master-data/references?type=COURIER');if(!couriers.some(row=>row.isActive&&row.metadata?.fulfillmentType==='PICKUP'))await api('/master-data/references',{method:'POST',body:{type:'COURIER',code:`PICK${String(Date.now()).slice(-9)}`,name:'Synthetic TEST pickup',branchId,metadata:{fulfillmentType:'PICKUP',price:0}}});
  await cdp.call('Page.navigate',{url:posUrl});await waitExpression(cdp,`document.body.innerText.includes('KIRIM / AMBIL BELAKANGAN')`,'P6CD POS order surface');
  await evaluateValue(cdp,`(()=>{const input=document.querySelector('input.search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(product.sku)});input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await waitExpression(cdp,`[...document.querySelectorAll('button.productMain')].some(node=>node.textContent.includes(${JSON.stringify(product.name)}))`,'P6CD POS product');
  await evaluateValue(cdp,`(()=>{[...document.querySelectorAll('button.productMain')].find(node=>node.textContent.includes(${JSON.stringify(product.name)})).click();return true;})()`);
  await evaluateValue(cdp,`(()=>{const select=[...document.querySelectorAll('.cart .summary select')].find(node=>[...node.options].some(option=>option.value===${JSON.stringify(customerId)}));if(!select)throw new Error('POS customer selector unavailable');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(customerId)});select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await waitExpression(cdp,`document.querySelector('.cart')?.getAttribute('data-quote-state')==='ready'`,'P6CD POS quote');
  await evaluateValue(cdp,`(()=>{const details=[...document.querySelectorAll('details')].find(node=>node.textContent.includes('KIRIM / AMBIL BELAKANGAN'));details.open=true;return true;})()`);
  const salesBeforeOrder=(await api('/sales?limit=100')).items.map(row=>row.id);
  await click('Buat pesanan dan periksa total');await waitExpression(cdp,`document.body.innerText.includes('Stok direservasi.') && document.querySelector('fieldset.layout')?.disabled`,'P6CD POS reservation lock');
  await click('Terima kas '+new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(50));
  await waitExpression(cdp,`document.body.innerText.includes('Lanjutkan inspeksi dan pemenuhan') && !document.querySelector('fieldset.layout')?.disabled && !document.querySelector('.items .item')`,'P6CD POS cash order confirmation');
  const orders=await api('/orders?limit=100');const paidOrder=orders.items.find(row=>row.customerId===customerId&&row.createdById);if(!paidOrder||paidOrder.status!=='PAID'||Number(paidOrder.total)!==50)throw new Error('P6CD POS did not create exactly paid canonical Order.');
  if((await api('/sales?limit=100')).items.some(row=>!salesBeforeOrder.includes(row.id)))throw new Error('Staff Order unexpectedly duplicated Sale.');
  evidence.checks.push({id:'P6CD_POS_STAFF_ORDER_CASH_BROWSER',status:'PASS',sourceType:'Order',saleDuplicated:false,matrix:await assertResponsiveMatrix(cdp,'P6CD POS ship-later'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-pos-ship-later')});
  // Separate real receipt access from customer campaign delivery. Ownership checked by API.
  const receiptSale=await api('/sales',{method:'POST',body:{warehouseId:warehouse.id,customerId,paymentMethod:'CASH',idempotencyKey:`p6cd-browser-receipt-${stamp}`,items:[{productId:product.id,quantity:1}]}});
  const share=await api(`/sales/${encodeURIComponent(receiptSale.number)}/receipt-link`);const html=await api(share.path);if(typeof html!=='string'||!html.includes(receiptSale.number))throw new Error('P6CD signed receipt unavailable.');
  const bare=await http(`${apiUrl}/receipts/${encodeURIComponent(receiptSale.number)}`);if(bare.status!==404)throw new Error('P6CD bare receipt exposed.');
  evidence.checks.push({id:'P6CD_SIGNED_RECEIPT_OWNERSHIP_API_RUNTIME',status:'PASS',bareDenied:true,signedAuthenticated:true});
  // Click the protected reprint and receipt delivery controls against the actual POS UI.
  await cdp.call('Page.navigate',{url:posUrl});
  const receiptRow=`[...document.querySelectorAll('.receiptHistory li')].find(node=>node.textContent.includes(${JSON.stringify(receiptSale.number)}))`;
  await waitExpression(cdp,`Boolean(${receiptRow})`,'P6CD POS receipt history');
  const targetsBefore=(await cdp.call('Target.getTargets')).targetInfos.map(row=>row.targetId);
  await click('Cetak ulang',receiptRow);
  let receiptTarget;const popupDeadline=Date.now()+15000;
  while(Date.now()<popupDeadline){receiptTarget=(await cdp.call('Target.getTargets')).targetInfos.find(row=>!targetsBefore.includes(row.targetId)&&row.url.startsWith(`${apiUrl}/receipts/${encodeURIComponent(receiptSale.number)}?share=`));if(receiptTarget)break;await new Promise(resolve=>setTimeout(resolve,200));}
  if(!receiptTarget)throw new Error('POS reprint did not open the authenticated signed receipt.');
  await cdp.call('Target.closeTarget',{targetId:receiptTarget.targetId});
  await api('/storefront/account/communication-preferences',{method:'PATCH',customerHeaders,body:{operationKey:`browser-receipt-consent-${stamp}`,marketingEmail:true,marketingWhatsapp:false,receiptEmail:true,receiptWhatsapp:false}});
  await click('Email struk',receiptRow);
  await waitExpression(cdp,`(${receiptRow})?.textContent.includes('Struk masuk antrean pengiriman')`,'P6CD consented POS receipt delivery');
  evidence.checks.push({id:'P6CD_POS_RECEIPT_REPRINT_DELIVERY_BROWSER',status:'PASS',signedPopup:true,consentedDeliveryQueued:true,screenshot:await captureSuccessScreenshot(cdp,'p6cd-pos-receipt')});
  // Real Tax Core document -> legal review form -> canonical worker -> authenticated XML download.
  const taxCode=await api('/accounting-core/tax-codes',{method:'POST',body:{code:`BVAT${String(Date.now()).slice(-9)}`,version:1,name:'Synthetic Browser TEST VAT',scope:'SALE',rate:0.11,status:'ACTIVE',payableAccountCode:'2201',legalReference:'Synthetic TEST only',calculationRules:{coretax:{vatRatePercent:'12',otherTaxBaseNumerator:'11',otherTaxBaseDenominator:'12'}}}});
  await api(`/products/${product.id}`,{method:'PATCH',body:{salesTaxCodeId:taxCode.id}});
  const taxSale=await api('/sales',{method:'POST',body:{warehouseId:warehouse.id,customerId,paymentMethod:'CASH',idempotencyKey:`browser-tax-sale-${stamp}`,items:[{productId:product.id,quantity:1}]}});
  await navigateAdminContext(cdp,'/finance/tax','P6CD legal XML operator');
  const taxPanel=`[...document.querySelectorAll('.panel')].find(node=>node.textContent.includes('Review dan export dokumen pajak'))`;
  await waitExpression(cdp,`Boolean(${taxPanel}) && [...(${taxPanel}).querySelectorAll('option')].some(node=>node.value===${JSON.stringify(taxSale.taxDocumentId)})`,'P6CD tax document controls');
  await field('Dokumen',taxSale.taxDocumentId,taxPanel);await click('Periksa source dan rekonsiliasi',taxPanel);
  await waitExpression(cdp,`(${taxPanel})?.textContent.includes('NPWP penjual (16 digit)')`,'P6CD legal review form');
  await field('NPWP penjual','0000000000000000',taxPanel);await field('NITKU penjual','0000000000000000000000',taxPanel);await field('Alamat pembeli','Synthetic TEST address',taxPanel);await field('Kode barang/jasa DJP','000000',taxPanel);await field('Kode satuan DJP','UM.0001',taxPanel);
  await click('Setujui mapping legal',taxPanel);await waitExpression(cdp,`(${taxPanel})?.textContent.includes('Mapping legal disetujui')`,'P6CD mapping approval');
  const xmlJobsBefore=new Set((await api('/reports/jobs?limit=100')).items.map(row=>row.id));
  await click('Buat export XML',taxPanel);await waitExpression(cdp,`(${taxPanel})?.textContent.includes('XML masuk antrean worker')`,'P6CD XML job queued');
  const xmlDeadline=Date.now()+60000;let xmlDone=false;
  while(Date.now()<xmlDeadline){await click('Periksa status XML',taxPanel);xmlDone=await evaluateValue(cdp,`(${taxPanel})?.textContent.includes('Unduh XML aman')`);if(xmlDone)break;await new Promise(resolve=>setTimeout(resolve,600));}
  if(!xmlDone)throw new Error('P6CD XML worker did not complete browser-created export.');
  await click('Unduh XML aman',taxPanel);
  const xmlJobs=await api('/reports/jobs?limit=100');const xmlJob=xmlJobs.items.find(row=>!xmlJobsBefore.has(row.id)&&row.reportType==='CORETAX_XML'&&row.status==='DONE');if(!xmlJob)throw new Error('Browser-created XML job unavailable.');const xml=await api(`/reports/jobs/${xmlJob.id}/download`);
  if(typeof xml!=='string'||!xml.includes('<VAT>5.50</VAT>')||!xml.includes('<OtherTaxBase>45.83</OtherTaxBase>'))throw new Error('Browser XML changed posted tax facts.');
  evidence.checks.push({id:'P6CD_CORETAX_REVIEW_WORKER_DOWNLOAD_BROWSER',status:'PASS',canonicalTaxPreserved:true,productionCertified:false,matrix:await assertResponsiveMatrix(cdp,'P6CD Coretax legal form'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-coretax-export')});
  // Actual exchange quote/confirmation controls after canonical inspector approval.
  const returned=await api('/returns/sales',{method:'POST',body:{saleId:receiptSale.id,warehouseId:warehouse.id,refundMethod:'ORIGINAL',reason:'Synthetic TEST browser exchange',items:[{saleItemId:receiptSale.items[0].id,quantity:1}]}});
  const inspectionPage=await api('/operations-control/inspections?limit=100');const inspection=inspectionPage.items.find(row=>row.id===returned.inspectionId);if(!inspection?.results?.length)throw new Error('Browser exchange inspection absent.');
  const results=inspection.results.map(row=>({... (row.templateItemId?{templateItemId:row.templateItemId}:{}),code:row.code,label:row.label,result:'PASS',...(row.productId?{productId:row.productId}:{}),...(row.expectedQty!=null?{expectedQty:row.expectedQty,acceptedQty:row.expectedQty,rejectedQty:0,damagedQty:0,missingQty:0,extraQty:0}:{}),...(row.scannedQty!=null?{scannedQty:row.scannedQty}:{})}));
  await api(`/operations-control/inspections/${returned.inspectionId}/complete`,{method:'POST',body:{results,notes:'Synthetic TEST inspector'}});await api(`/operations-control/inspections/${returned.inspectionId}/approve`,{method:'POST',body:{notes:'Synthetic TEST inspection approval'}});
  await cdp.call('Page.navigate',{url:posUrl});await waitExpression(cdp,`document.body.innerText.includes('TOKO360 POS')`,'P6CD POS exchange ready');await click('Retur');
  const exchangePanel=`[...document.querySelectorAll('details')].find(node=>node.textContent.includes('TUKAR BARANG LANGSUNG'))`;
  await waitExpression(cdp,`Boolean(${exchangePanel}) && [...(${exchangePanel}).querySelectorAll('option')].some(node=>node.value===${JSON.stringify(returned.id)})`,'P6CD exchange controls');
  await evaluateValue(cdp,`(()=>{(${exchangePanel}).open=true;return true;})()`);
  await field('Retur asal',returned.id,exchangePanel);await field('Barang pengganti',product.id,exchangePanel);await click('Hitung selisih server',exchangePanel);
  await waitExpression(cdp,`(${exchangePanel})?.textContent.includes('Konfirmasi tukar dan selisih kas')`,'P6CD exchange quote');await click('Konfirmasi tukar dan selisih kas',exchangePanel);
  await waitExpression(cdp,`(${exchangePanel})?.textContent.includes('Tukar barang selesai.')`,'P6CD exchange completion');
  const persistedReturn=(await api('/returns/sales')).find(row=>row.id===returned.id);if(persistedReturn?.status!=='COMPLETED')throw new Error('Exchange UI did not atomically complete inspected return.');
  evidence.checks.push({id:'P6CD_POS_EXCHANGE_CONFIRM_BROWSER',status:'PASS',canonicalInspectionApproved:true,matrix:await assertResponsiveMatrix(cdp,'P6CD exchange'),screenshot:await captureSuccessScreenshot(cdp,'p6cd-pos-exchange')});
  for(const key of ['retail_exchange','customer_deposit','customer_campaign','pos_ship_later','tax_export']) {const prior=flags.find(row=>row.key===key&&row.branchId===branchId&&!row.userId);await api('/platform/features',{method:'POST',body:{key,branchId,enabled:prior?.enabled??false,config:prior?.config??(key==='customer_deposit'?{accountCode:depositCode}:{})}});}
  await cdp.call('Page.navigate',{url:posUrl});await waitExpression(cdp,`document.body.innerText.includes('TOKO360 POS')`,'P6CD final POS cleanup');
}
