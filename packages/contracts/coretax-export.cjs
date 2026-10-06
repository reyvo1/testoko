'use strict';
const { createHash } = require('node:crypto');
const CONTRACTS = Object.freeze({
  FAKTUR_PK_1_4: { root:'TaxInvoiceBulk', list:'ListOfTaxInvoice', item:'TaxInvoice', hash:'a71d6c004f7d0979b9f33eedc7f669daf3238e6820d2decd13525f2cc32b9beb' },
  BPPU_2024_11: { root:'BpuBulk', list:'ListOfBpu', item:'Bpu', hash:'8a90ea38737bd8d5f0563c12c11ec076b91138f0865ac9f46fd0d4414b004deb' },
});
exports.CORETAX_CONTRACTS = CONTRACTS;
const invoiceKeys = ['TaxInvoiceOpt','TrxCode','AddInfo','CustomDoc','CustomDocMonthYear','FacilityStamp','BuyerDocument','BuyerCountry','BuyerDocumentNumber','BuyerIDTKU','BuyerEmail','BuyerAdress'];
const bppuKeys = ['IDPlaceOfBusinessActivityOfIncomeRecipient','TaxCertificate','TaxObjectCode','Document','GovTreasurerOpt','SP2DNumber'];
function text(value, required = false) { if (typeof value !== 'string' || value.length > 500 || /[\x00-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF]/u.test(value) || (required && !value.trim())) throw new Error('Invalid or missing Coretax legal mapping.'); return value; }
function identifier(value, length) { const string = text(value,true); if (!new RegExp(`^\\d{${length}}$`).test(string)) throw new Error('Invalid Coretax TIN/NITKU format.'); return string; }
exports.validateTaxExportMapping = function validateTaxExportMapping(contract, mapping) {
  if (!CONTRACTS[contract] || !mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('Unsupported Coretax contract.');
  const allowed = [...(contract === 'FAKTUR_PK_1_4' ? invoiceKeys : bppuKeys),'SellerTIN','SellerIDTKU','goods'];
  if (Object.keys(mapping).some(key => !allowed.includes(key))) throw new Error('Coretax mapping cannot override canonical amounts/rates/identity.');
  const result = { SellerTIN:identifier(mapping.SellerTIN,16), SellerIDTKU:identifier(mapping.SellerIDTKU,22) };
  for (const key of (contract === 'FAKTUR_PK_1_4' ? invoiceKeys : bppuKeys)) result[key] = text(mapping[key] ?? '',['TaxInvoiceOpt','TrxCode','BuyerDocument','BuyerCountry','BuyerAdress','TaxObjectCode','Document','IDPlaceOfBusinessActivityOfIncomeRecipient','GovTreasurerOpt'].includes(key));
  if (contract === 'FAKTUR_PK_1_4') {
    if (!/^[0-9]{2}$/.test(result.TrxCode) || !['Normal','Replacement'].includes(result.TaxInvoiceOpt) || result.TaxInvoiceOpt !== 'Normal') throw new Error('Unsupported invoice transaction or correction mapping.');
    if (result.BuyerIDTKU) identifier(result.BuyerIDTKU,22);
    if (!mapping.goods || typeof mapping.goods !== 'object' || Array.isArray(mapping.goods) || Object.keys(mapping.goods).length > 100) throw new Error('Missing bounded goods mapping.');
    result.goods = {};
    for (const [id,goods] of Object.entries(mapping.goods)) {
      if (!id || id.length > 160 || !goods || typeof goods !== 'object' || Array.isArray(goods) || Object.keys(goods).some(key => !['Opt','Code','Unit'].includes(key))) throw new Error('Invalid goods mapping.');
      if (!['A','B'].includes(goods.Opt)) throw new Error('Invalid goods/service option.');
      result.goods[id] = { Opt:goods.Opt,Code:text(goods.Code,true),Unit:text(goods.Unit,true) };
    }
  } else { identifier(result.IDPlaceOfBusinessActivityOfIncomeRecipient,22); }
  return result;
};
const escape = value => text(String(value)).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' })[c]);
const tag = (name,value) => `<${name}>${escape(value ?? '')}</${name}>`;
function canonicalJson(value) { if (Array.isArray(value)) return value.map(canonicalJson); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalJson(value[key])])); return value; }
// PostgreSQL JSONB reorders object keys. Hash semantic facts while retaining array order.
exports.taxExportChecksum = payload => createHash('sha256').update(JSON.stringify(canonicalJson(payload))).digest('hex');
exports.renderCoretaxExport = function renderCoretaxExport(payload) {
  const spec = CONTRACTS[payload?.contract];
  if (!spec || payload.version !== 1 || payload.templateHash !== spec.hash || !Array.isArray(payload.documents) || !payload.documents.length || payload.documents.length > 100) throw new Error('Invalid Coretax export snapshot.');
  if (exports.taxExportChecksum({ contract:payload.contract,version:payload.version,templateHash:payload.templateHash,documents:payload.documents }) !== payload.checksum) throw new Error('Coretax export checksum mismatch.');
  const seller = payload.documents[0].mapping.SellerTIN;
  const rows = payload.documents.map(doc => {
    const mapping = exports.validateTaxExportMapping(payload.contract,doc.mapping); const facts = doc.facts;
    if (mapping.SellerTIN !== seller || !facts || !/^\d{4}-\d{2}-\d{2}$/.test(facts.date) || !facts.buyerTin || !facts.number) throw new Error('Invalid Coretax canonical facts.');
    if (payload.contract === 'FAKTUR_PK_1_4') {
      if (!Array.isArray(facts.lines) || !facts.lines.length || facts.lines.length > 100) throw new Error('Missing canonical invoice lines.');
      const lines = facts.lines.map(line => { const goods = mapping.goods[line.productId]; if (!goods) throw new Error('Missing invoice goods mapping.');
        const fields = { ...goods,Name:line.name,Price:line.price,Qty:line.quantity,TotalDiscount:line.discount,TaxBase:line.net,OtherTaxBase:line.otherTaxBase,VATRate:line.vatRate,VAT:line.tax,STLGRate:'0',STLG:'0' };
        for (const key of ['Price','Qty','TotalDiscount','TaxBase','OtherTaxBase','VATRate','VAT']) if (!/^\d+(\.\d{1,8})?$/.test(String(fields[key]))) throw new Error('Invalid canonical invoice amount.');
        return `<GoodService>${['Opt','Code','Name','Unit','Price','Qty','TotalDiscount','TaxBase','OtherTaxBase','VATRate','VAT','STLGRate','STLG'].map(key=>tag(key,fields[key])).join('')}</GoodService>`; });
      const fields = { TaxInvoiceDate:facts.date,...mapping,RefDesc:facts.number,BuyerTin:facts.buyerTin,BuyerName:facts.buyerName };
      return `<TaxInvoice>${['TaxInvoiceDate','TaxInvoiceOpt','TrxCode','AddInfo','CustomDoc','CustomDocMonthYear','RefDesc','FacilityStamp','SellerIDTKU','BuyerTin','BuyerDocument','BuyerCountry','BuyerDocumentNumber','BuyerName','BuyerAdress','BuyerIDTKU','BuyerEmail'].map(key=>tag(key,fields[key])).join('')}<ListOfGoodService>${lines.join('')}</ListOfGoodService></TaxInvoice>`;
    }
    if (!/^\d+(\.\d{1,8})?$/.test(facts.net) || !/^\d+(\.\d{1,8})?$/.test(facts.rate)) throw new Error('Invalid withholding facts.');
    const fields = { ...mapping,TaxPeriodMonth:String(Number(facts.date.slice(5,7))),TaxPeriodYear:facts.date.slice(0,4),CounterpartTin:facts.buyerTin,TaxBase:facts.net,Rate:facts.rate,DocumentNumber:facts.number,DocumentDate:facts.date,IDPlaceOfBusinessActivity:mapping.SellerIDTKU,WithholdingDate:facts.date };
    return `<Bpu>${['TaxPeriodMonth','TaxPeriodYear','CounterpartTin','IDPlaceOfBusinessActivityOfIncomeRecipient','TaxCertificate','TaxObjectCode','TaxBase','Rate','Document','DocumentNumber','DocumentDate','IDPlaceOfBusinessActivity','GovTreasurerOpt','SP2DNumber','WithholdingDate'].map(key=>tag(key,fields[key])).join('')}</Bpu>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><${spec.root}>${tag('TIN',seller)}<${spec.list}>${rows.join('')}</${spec.list}></${spec.root}>`;
};
