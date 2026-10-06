import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { communicationRecipient, contactHash } from '@toko360/contracts/customer-communications.cjs';
import { AuthUser } from '../auth/auth.types';
import { beginIdempotent, completeIdempotent } from '../common/idempotency';
import { decodeDateIdCursor, parsePageLimit, toCursorPage } from '../common/pagination';
import { mintReceiptShare } from '../common/receipt-access';
import { retailAuthority, retailFeature, retailScope } from '../common/retail-feature';
import { serializableTx } from '../common/serializable-tx';
import { PrismaService } from '../prisma/prisma.service';
import { CancelCustomerCampaignDto, CommunicationPreferenceDto, CreateCustomerCampaignDto, QueueCustomerReceiptDto } from './dto/customer-communications.dto';
import { StorefrontCustomerService } from './storefront-customer.service';

const preferenceSelect = { marketingEmail: true, marketingWhatsapp: true, receiptEmail: true, receiptWhatsapp: true, policyVersion: true, updatedAt: true } as const;
function key(value: string) { if (!value?.trim() || value.length > 160) throw new BadRequestException('Operation key wajib, maksimal 160 karakter.'); return value; }

@Injectable()
export class CustomerCommunicationsService {
  constructor(private readonly prisma: PrismaService, private readonly customers: StorefrontCustomerService, private readonly config: ConfigService) {}

  async preferences(branchCode?: string, token?: string) {
    const identity = await this.customers.authenticate(branchCode, token);
    return await this.prisma.customerCommunicationPreference.findUnique({ where: { customerId: identity.customerId }, select: preferenceSelect }) ?? { marketingEmail: false, marketingWhatsapp: false, receiptEmail: false, receiptWhatsapp: false, policyVersion: 'retail-communications-v1', updatedAt: null };
  }

  async savePreferences(dto: CommunicationPreferenceDto, branchCode?: string, token?: string) {
    const identity = await this.customers.authenticate(branchCode, token); key(dto.operationKey);
    if (![dto.marketingEmail,dto.marketingWhatsapp,dto.receiptEmail,dto.receiptWhatsapp].every((value) => typeof value === 'boolean')) throw new BadRequestException('Pilihan komunikasi harus boolean eksplisit.');
    return serializableTx(this.prisma, async (tx) => {
      const scope = `customer:communications:${identity.customerId}`;
      const gate = await beginIdempotent(tx, { companyId: identity.companyId, scope, key: dto.operationKey, payload: dto });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      const customer = await tx.customer.findFirst({ where: { id: identity.customerId, companyId: identity.companyId, account: { is: { isActive: true } } } });
      if (!customer) throw new NotFoundException('Akun pelanggan tidak aktif.');
      if ((dto.marketingEmail || dto.receiptEmail) && (!customer.email || !customer.emailVerifiedAt)) throw new BadRequestException('Verifikasi email sebelum mengaktifkan komunikasi email.');
      if ((dto.marketingWhatsapp || dto.receiptWhatsapp) && (!customer.phone || !customer.phoneVerifiedAt)) throw new BadRequestException('Verifikasi nomor sebelum mengaktifkan komunikasi WhatsApp.');
      const data = { marketingEmail: dto.marketingEmail, marketingWhatsapp: dto.marketingWhatsapp, receiptEmail: dto.receiptEmail, receiptWhatsapp: dto.receiptWhatsapp, policyVersion: 'retail-communications-v1', emailTargetHash: dto.marketingEmail || dto.receiptEmail ? contactHash(customer.email) : null, phoneTargetHash: dto.marketingWhatsapp || dto.receiptWhatsapp ? contactHash(customer.phone) : null };
      const preference = await tx.customerCommunicationPreference.upsert({ where: { customerId: identity.customerId }, create: { customerId: identity.customerId, ...data }, update: data, select: preferenceSelect });
      await tx.auditLog.create({ data: { companyId: identity.companyId, action: 'CUSTOMER_COMMUNICATION_PREFERENCE', entityType: 'Customer', entityId: identity.customerId, payload: { policyVersion: data.policyVersion, marketingEmail: data.marketingEmail, marketingWhatsapp: data.marketingWhatsapp, receiptEmail: data.receiptEmail, receiptWhatsapp: data.receiptWhatsapp } } });
      await completeIdempotent(tx, { companyId: identity.companyId, scope, key: dto.operationKey, resourceType: 'CustomerCommunicationPreference', response: preference });
      return preference;
    });
  }

  async campaigns(user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = retailScope(user); const limit = parsePageLimit(limitValue); const cursor = decodeDateIdCursor(cursorValue);
    const rows = await this.prisma.customerCampaign.findMany({ where: { ...scope, ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) }, select: { id: true, channel: true, templateCode: true, status: true, createdAt: true, _count: { select: { deliveries: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    return toCursorPage(rows, limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async campaignDeliveries(id: string, user: AuthUser, limitValue?: string, cursorValue?: string) {
    const scope = retailScope(user); const limit = parsePageLimit(limitValue); const cursor = decodeDateIdCursor(cursorValue);
    if (!await this.prisma.customerCampaign.findFirst({ where: { id, ...scope }, select: { id: true } })) throw new NotFoundException('Campaign tidak tersedia.');
    const rows = await this.prisma.customerCampaignDelivery.findMany({ where: { campaignId: id, ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const notifications = await this.prisma.notification.findMany({ where: { companyId: scope.companyId, id: { in: rows.map((row) => row.notificationId) } }, select: { id: true, status: true, attempts: true, sentAt: true, deliveredAt: true } });
    const map = new Map(notifications.map((row) => [row.id, row]));
    return toCursorPage(rows.map((row) => ({ id: row.id, createdAt: row.createdAt, notification: map.get(row.notificationId) ?? null })), limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async createCampaign(dto: CreateCustomerCampaignDto, user: AuthUser) {
    retailAuthority(user, ['SUPER_ADMIN','OWNER','ADMIN'], ['notification.manage']); const scope = retailScope(user); key(dto.operationKey);
    if (!['EMAIL','WHATSAPP'].includes(dto.channel)) throw new BadRequestException('Channel campaign tidak didukung.');
    return serializableTx(this.prisma, async (tx) => {
      const idemScope = `customer:campaign:${scope.branchId}`;
      const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, payload: dto });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      await retailFeature(tx, scope, 'customer_campaign');
      const template = await tx.notificationTemplate.findFirst({ where: { companyId: scope.companyId, code: dto.templateCode, channel: dto.channel, isActive: true } });
      if (!template || !template.body.trim() || template.body.length > 4000 || (template.subject?.length ?? 0) > 160 || /\{\{|\}\}/.test(template.body + (template.subject ?? ''))) throw new BadRequestException('Template campaign harus aktif, berbatas, dan tidak memiliki variabel yang belum diselesaikan.');
      const campaign = await tx.customerCampaign.create({ data: { ...scope, channel: dto.channel, templateCode: template.code, subject: template.subject, body: template.body, operationKey: dto.operationKey, createdById: user.sub } });
      await tx.automationJob.create({ data: { ...scope, eventType: 'customer.campaign.batch', sourceType: 'CustomerCampaign', sourceId: campaign.id, actionType: 'ENQUEUE_CUSTOMER_CAMPAIGN', payload: {}, idempotencyKey: `campaign:${campaign.id}:first` } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CREATE_CUSTOMER_CAMPAIGN', entityType: 'CustomerCampaign', entityId: campaign.id, payload: { branchId: scope.branchId, channel: dto.channel, templateCode: template.code } } });
      const result = { id: campaign.id, channel: campaign.channel, templateCode: campaign.templateCode, status: campaign.status };
      await completeIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, resourceType: 'CustomerCampaign', resourceId: campaign.id, response: result }); return result;
    });
  }

  async cancelCampaign(id: string, dto: CancelCustomerCampaignDto, user: AuthUser) {
    retailAuthority(user, ['SUPER_ADMIN','OWNER','ADMIN'], ['notification.manage']); const scope = retailScope(user); key(dto.operationKey);
    return serializableTx(this.prisma, async (tx) => {
      const idemScope = `customer:campaign:cancel:${scope.branchId}`;
      const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, payload: { id, ...dto } });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      const row = await tx.customerCampaign.findFirst({ where: { id, ...scope } }); if (!row) throw new NotFoundException('Campaign tidak tersedia.');
      await tx.customerCampaign.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.automationJob.updateMany({ where: { ...scope, sourceType: 'CustomerCampaign', sourceId: id, status: { in: ['PENDING','RETRYING'] } }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'CANCEL_CUSTOMER_CAMPAIGN', entityType: 'CustomerCampaign', entityId: id, payload: { branchId: scope.branchId } } });
      const result = { id, status: 'CANCELLED' };
      await completeIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, resourceType: 'CustomerCampaign', resourceId: id, response: result }); return result;
    });
  }

  async receipts(branchCode?: string, token?: string, limitValue?: string, cursorValue?: string) {
    const identity = await this.customers.authenticate(branchCode, token); const limit = parsePageLimit(limitValue); const cursor = decodeDateIdCursor(cursorValue);
    const rows = await this.prisma.sale.findMany({ where: { customerId: identity.customerId, branchId: identity.branchId, branch: { companyId: identity.companyId }, status: 'COMPLETED', ...(cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {}) }, select: { id: true, number: true, total: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    return toCursorPage(rows, limit, (row) => ({ createdAt: row.createdAt.toISOString(), id: row.id }));
  }

  async customerReceiptLink(number: string, branchCode?: string, token?: string) {
    const identity = await this.customers.authenticate(branchCode, token);
    const sale = await this.prisma.sale.findFirst({ where: { number, customerId: identity.customerId, branchId: identity.branchId, branch: { companyId: identity.companyId } }, select: { id: true, number: true, branchId: true } });
    if (!sale) throw new NotFoundException('Struk tidak tersedia.');
    const share = mintReceiptShare(sale, identity.companyId, this.config.get<string>('RECEIPT_SIGNING_KEY') ?? this.config.get<string>('JWT_SECRET') ?? '');
    return { path: `/receipts/${encodeURIComponent(sale.number)}?share=${encodeURIComponent(share)}`, expiresIn: 3600 };
  }

  async queueReceipt(saleId: string, dto: QueueCustomerReceiptDto, user: AuthUser) {
    retailAuthority(user, ['SUPER_ADMIN','OWNER','ADMIN','CASHIER','FINANCE'], ['sale.view']); const scope = retailScope(user); key(dto.operationKey);
    if (!['EMAIL','WHATSAPP'].includes(dto.channel)) throw new BadRequestException('Channel struk tidak didukung.');
    return serializableTx(this.prisma, async (tx) => {
      const idemScope = `customer:receipt:${scope.branchId}`;
      const gate = await beginIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, payload: { saleId, ...dto } });
      if (gate.replay && gate.status === 'COMPLETED') return gate.response;
      await retailFeature(tx, scope, 'customer_campaign');
      const sale = await tx.sale.findFirst({ where: { id: saleId, branchId: scope.branchId, branch: { companyId: scope.companyId }, status: 'COMPLETED' }, select: { number: true, customerId: true } });
      const customer = sale?.customerId ? await tx.customer.findFirst({ where: { id: sale.customerId, companyId: scope.companyId }, include: { account: true, communicationPreference: true } }) : null;
      const recipient = communicationRecipient(customer, dto.channel, 'RECEIPT');
      if (!sale || !recipient) throw new BadRequestException('Struk memerlukan pelanggan terverifikasi yang mengizinkan channel ini.');
      const configured = this.config.get<string>('STOREFRONT_PUBLIC_URL');
      let base: URL | null = null;
      try { base = configured ? new URL(configured) : null; } catch { /* invalid configuration rejected below */ }
      if (!base || base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(base.hostname) && base.protocol === 'http:' && this.config.get<string>('NODE_ENV') !== 'production'))) throw new BadRequestException('Alamat akun pelanggan aman belum dikonfigurasi.');
      const notification = await tx.notification.create({ data: { companyId: scope.companyId, channel: dto.channel, recipient, subject: `Struk ${sale.number}`, body: `Struk ${sale.number} tersedia di akun Anda. Masuk ke ${base.href.replace(/\/$/, '')}/account untuk melihatnya.`, data: { customerCommunication: 1, purpose: 'RECEIPT', branchId: scope.branchId, customerId: customer!.id, saleId } } });
      await tx.auditLog.create({ data: { companyId: scope.companyId, userId: user.sub, action: 'QUEUE_CUSTOMER_RECEIPT', entityType: 'Notification', entityId: notification.id, payload: { branchId: scope.branchId, saleId, channel: dto.channel } } });
      const result = { id: notification.id, status: notification.status };
      await completeIdempotent(tx, { companyId: scope.companyId, scope: idemScope, key: dto.operationKey, resourceType: 'Notification', resourceId: notification.id, response: result }); return result;
    });
  }
}
