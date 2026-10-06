import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CORETAX_CONTRACTS, renderCoretaxExport, taxExportChecksum, validateTaxExportMapping } from '@toko360/contracts/coretax-export.cjs';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { retailAuthority, retailFeature, retailScope } from '../common/retail-feature';
import { serializableTx } from '../common/serializable-tx';
import { businessDateKey } from '../common/business-time';
import { ApproveTaxExportMappingDto, CreateTaxExportDto } from './dto/tax-export.dto';

const decimal = (value: Prisma.Decimal.Value) => { try { const result = new Prisma.Decimal(value); if (!result.isFinite()) throw new Error(); return result; } catch { throw new BadRequestException('Nominal/rate konfigurasi Tax Core tidak valid.'); } };
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

@Injectable()
export class TaxExportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async facts(tx: Prisma.TransactionClient, document: Prisma.TaxDocumentGetPayload<Record<string, never>>, contract: string) {
    if (!document.branchId || !document.counterpartyTaxId || !/^\d{16}$/.test(document.counterpartyTaxId) || !document.counterpartyName?.trim()) throw new BadRequestException('Identitas pajak counterparty pada dokumen harus sudah lengkap dan direview.');
    const transactions = await tx.taxTransaction.findMany({ where: { companyId: document.companyId, branchId: document.branchId, sourceType: document.sourceType, sourceId: document.sourceId, status: 'POSTED', event: { status: 'POSTED' } }, take: 101 });
    if (!transactions.length || transactions.length > 100 || !transactions.reduce((sum,row) => sum.add(row.taxAmount), decimal(0)).equals(document.taxAmount)) throw new BadRequestException('Dokumen harus rekonsiliasi dengan TaxTransaction yang diposting.');
    const company = await tx.company.findUnique({ where:{ id:document.companyId },select:{ timezone:true } });
    if (!company?.timezone) throw new BadRequestException('Kalender company untuk export pajak belum tersedia.');
    const date = businessDateKey(document.issueDate,company.timezone);
    if ((document.taxPeriod && document.taxPeriod !== date.slice(0,7)) || transactions.some(row => row.taxPeriod !== date.slice(0,7))) throw new BadRequestException('Periode pajak historis tidak cocok dengan kalender company; review/koreksi canonical diperlukan sebelum export.');
    const facts = { date,number:document.number,buyerTin:document.counterpartyTaxId,buyerName:document.counterpartyName };
    if (contract === 'BPPU_2024_11') {
      if (transactions.length !== 1 || transactions[0].direction !== 'WITHHOLDING' || !transactions[0].taxableBase.equals(document.netAmount)) throw new BadRequestException('BPPU memerlukan satu objek withholding dengan base canonical yang cocok.');
      const code = await tx.taxCode.findFirst({ where: { id:transactions[0].taxCodeId,companyId:document.companyId } });
      if (!code || !decimal(document.netAmount).mul(code.rate).toDecimalPlaces(2).equals(document.taxAmount)) throw new BadRequestException('Tarif withholding tidak rekonsiliasi.');
      const objectCode = object(object(code.calculationRules).coretax).bppuObjectCode;
      if (typeof objectCode !== 'string' || !objectCode.trim()) throw new BadRequestException('Objek BPPU pada version Tax Core belum direview.');
      return { ...facts,net:document.netAmount.toFixed(2),rate:code.rate.mul(100).toFixed(8),taxCodeId:code.id,taxCodeVersion:code.version,taxObjectCode:objectCode };
    }
    if (!['Sale','Order'].includes(document.sourceType) || transactions.some(row => row.direction !== 'OUTPUT')) throw new BadRequestException('Faktur hanya untuk Sale/Order OUTPUT canonical. Retur/koreksi memerlukan kontrak tersendiri.');
    const source = document.sourceType === 'Sale'
      ? await tx.sale.findFirst({ where: { id:document.sourceId,branchId:document.branchId,branch:{ companyId:document.companyId } },include:{ items:{ include:{ product:true } } } })
      : await tx.order.findFirst({ where: { id:document.sourceId,branchId:document.branchId,branch:{ companyId:document.companyId } },include:{ items:{ include:{ product:true } } } });
    if (!source || source.items.length > 100 || !source.total.equals(document.grossAmount)) throw new BadRequestException('Source faktur tidak cocok atau melebihi batch.');
    const ids = [...new Set(source.items.flatMap(item => item.taxCodeId ? [item.taxCodeId] : []))];
    const codes = await tx.taxCode.findMany({ where: { id:{ in:ids },companyId:document.companyId } });
    const lines = source.items.map(item => {
      const quantity = item.unitQuantity ?? item.quantity;
      const code = codes.find(c => c.id === item.taxCodeId);
      if (item.taxCodeId && !code) throw new BadRequestException('Version tax code source tidak tersedia.');
      const config = object(object(code?.calculationRules).coretax);
      if (config.stlgRatePercent && String(config.stlgRatePercent) !== '0') throw new BadRequestException('PPnBM memerlukan kontrak dan source terpisah yang lengkap.');
      if (code && (typeof config.vatRatePercent !== 'string' || typeof config.otherTaxBaseNumerator !== 'string' || typeof config.otherTaxBaseDenominator !== 'string')) throw new BadRequestException('Mapping tarif/DPP Coretax pada version Tax Core belum lengkap.');
      const vatRate = decimal(code ? config.vatRatePercent as string : 0);
      const numerator = decimal(code ? config.otherTaxBaseNumerator as string : 1);
      const denominator = decimal(code ? config.otherTaxBaseDenominator as string : 1);
      if (!vatRate.isFinite() || vatRate.lt(0) || vatRate.gt(100) || !numerator.isFinite() || numerator.lte(0) || !denominator.isFinite() || denominator.lte(0) || numerator.gt(denominator)) throw new BadRequestException('Mapping tarif/DPP Coretax tidak valid.');
      const otherTaxBase = item.netSubtotal.mul(numerator).div(denominator).toDecimalPlaces(2);
      if (otherTaxBase.mul(vatRate).div(100).toDecimalPlaces(2).sub(item.taxAmount).abs().gt('0.02')) throw new BadRequestException('Mapping DPP/tarif tidak rekonsiliasi dengan pajak source; buat version legal yang benar.');
      // Historical, immutable Tax Core version determines display before discount, never the payable tax.
      const rawPrice = document.sourceType === 'Sale' ? item.unitPrice.mul(item.quantityFactor) : item.unitPrice;
      const beforeDiscountNet = code?.inclusive ? rawPrice.mul(quantity).div(decimal(1).add(code.rate)).toDecimalPlaces(2) : rawPrice.mul(quantity);
      const discount = beforeDiscountNet.sub(item.netSubtotal).toDecimalPlaces(2);
      if (discount.lt(0)) throw new BadRequestException('Snapshot harga/diskon source tidak rekonsiliasi.');
      return { productId:item.productId,name:item.product.name,quantity:String(quantity),price:beforeDiscountNet.div(quantity).toFixed(8),discount:discount.toFixed(2),net:item.netSubtotal.toFixed(2),otherTaxBase:otherTaxBase.toFixed(2),vatRate:vatRate.toFixed(8),tax:item.taxAmount.toFixed(2),taxCodeId:code?.id ?? null,taxCodeVersion:code?.version ?? null };
    });
    if (!lines.reduce((sum,line) => sum.add(line.net),decimal(0)).equals(document.netAmount) || !lines.reduce((sum,line) => sum.add(line.tax),decimal(0)).equals(document.taxAmount) || !document.netAmount.add(document.taxAmount).equals(document.grossAmount)) throw new BadRequestException('Faktur termasuk ongkir/biaya tambahan belum memiliki line pajak lengkap; export ditolak.');
    return { ...facts,lines };
  }

  async draft(id: string, contract: string, user: AuthUser) {
    retailAuthority(user,['SUPER_ADMIN','OWNER','FINANCE'],['tax.view']); const scope = retailScope(user);
    if (!CORETAX_CONTRACTS[contract]) throw new BadRequestException('Kontrak tidak didukung.');
    return serializableTx(this.prisma,async tx => {
      const document = await tx.taxDocument.findFirst({where:{id,...scope,status:'ISSUED'}});
      if (!document) throw new NotFoundException('Dokumen pajak tidak tersedia.');
      const facts = await this.facts(tx,document,contract);
      return { documentId:id,contract,facts,mappingApproved:Boolean(object(document.metadata).coretaxExport),productionCertified:false };
    });
  }

  async approve(id: string, dto: ApproveTaxExportMappingDto, user: AuthUser) {
    retailAuthority(user,['SUPER_ADMIN','OWNER','FINANCE'],['tax.manage']); const scope = retailScope(user);
    return serializableTx(this.prisma,async tx => {
      const idemScope = `tax:export-mapping:${scope.branchId}`; const gate = await beginIdempotent(tx,{ companyId:scope.companyId,scope:idemScope,key:dto.operationKey,payload:{ id,...dto } });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      await retailFeature(tx,scope,'tax_export');
      const document = await tx.taxDocument.findFirst({ where:{ id,...scope,status:'ISSUED' } });
      if (!document) throw new NotFoundException('Dokumen pajak tidak tersedia.');
      const metadata = object(document.metadata);
      if (metadata.coretaxExport) throw new BadRequestException('Mapping sudah menjadi snapshot. Koreksi melalui dokumen pembalik/koreksi canonical.');
      let mapping: Record<string,unknown>;
      try { mapping = validateTaxExportMapping(dto.contract,dto.mapping); } catch { throw new BadRequestException('Mapping legal Coretax tidak valid atau memuat override nominal/rate.'); }
      const facts = await this.facts(tx,document,dto.contract);
      if (dto.contract === 'BPPU_2024_11' && mapping.TaxObjectCode !== (facts as { taxObjectCode?: string }).taxObjectCode) throw new BadRequestException('Objek BPPU harus cocok dengan version Tax Core source.');
      const snapshot = { documentId:id,mapping,facts,approvedById:user.sub,approvedAt:new Date().toISOString() };
      const payload = { contract:dto.contract,version:1,templateHash:CORETAX_CONTRACTS[dto.contract].hash,documents:[snapshot] };
      try { renderCoretaxExport({ ...payload,checksum:taxExportChecksum(payload) }); } catch { throw new BadRequestException('Mapping dan source XML belum lengkap/valid.'); }
      await tx.taxDocument.update({ where:{ id },data:{ metadata:{ ...metadata,coretaxExport:{ contract:dto.contract,templateHash:payload.templateHash,...snapshot } } as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data:{ companyId:scope.companyId,userId:user.sub,action:'APPROVE_CORETAX_EXPORT_MAPPING',entityType:'TaxDocument',entityId:id,payload:{ contract:dto.contract,templateHash:payload.templateHash,checksum:taxExportChecksum(snapshot) } } });
      const response = { id,contract:dto.contract,status:'MAPPING_APPROVED',productionCertified:false };
      await completeIdempotent(tx,{ companyId:scope.companyId,scope:idemScope,key:dto.operationKey,resourceType:'TaxDocument',resourceId:id,response });return response;
    });
  }

  async create(dto: CreateTaxExportDto, user: AuthUser) {
    retailAuthority(user,['SUPER_ADMIN','OWNER','FINANCE'],['tax.manage','report.export']); const scope = retailScope(user);
    return serializableTx(this.prisma,async tx => {
      const idemScope = `tax:export:${scope.branchId}`;const gate = await beginIdempotent(tx,{ companyId:scope.companyId,scope:idemScope,key:dto.operationKey,payload:dto });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      await retailFeature(tx,scope,'tax_export');
      const ids = [...new Set(dto.documentIds)]; if (!ids.length || ids.length > 100 || !CORETAX_CONTRACTS[dto.contract]) throw new BadRequestException('Batch/kontrak export tidak valid.');
      const rows = await tx.taxDocument.findMany({ where:{ id:{ in:ids },...scope,status:'ISSUED' } });
      if (rows.length !== ids.length) throw new NotFoundException('Dokumen batch tidak tersedia.');
      const documents = ids.map(id => { const snapshot = object(object(rows.find(row=>row.id===id)!.metadata).coretaxExport); if (snapshot.contract !== dto.contract || snapshot.templateHash !== CORETAX_CONTRACTS[dto.contract].hash || !snapshot.approvedById) throw new BadRequestException('Mapping dokumen belum direview untuk kontrak ini.'); return { documentId:id,mapping:snapshot.mapping,facts:snapshot.facts,approvedById:snapshot.approvedById,approvedAt:snapshot.approvedAt }; });
      const payload = { contract:dto.contract,version:1,templateHash:CORETAX_CONTRACTS[dto.contract].hash,documents };const checksum = taxExportChecksum(payload);
      try { renderCoretaxExport({ ...payload,checksum }); } catch { throw new BadRequestException('Snapshot export tidak valid.'); }
      const job = await tx.reportJob.create({ data:{ ...scope,requestedById:user.sub,reportType:'CORETAX_XML',format:'XML',filters:{ ...payload,checksum } as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000) } });
      await tx.auditLog.create({ data:{ companyId:scope.companyId,userId:user.sub,action:'QUEUE_CORETAX_EXPORT',entityType:'ReportJob',entityId:job.id,payload:{ contract:dto.contract,count:ids.length,checksum } } });
      const response = { id:job.id,status:job.status,contract:dto.contract,productionCertified:false };
      await completeIdempotent(tx,{ companyId:scope.companyId,scope:idemScope,key:dto.operationKey,resourceType:'ReportJob',resourceId:job.id,response }); return response;
    });
  }
}
