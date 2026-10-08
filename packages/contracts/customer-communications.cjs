'use strict';
// Shared runtime policy for API and worker. No API build artifacts or transport calls.
const { createHash } = require('node:crypto');
exports.contactHash = function contactHash(value) { return createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex'); };

exports.communicationRecipient = function communicationRecipient(customer, channel, purpose) {
  if (!customer?.account?.isActive || !customer.communicationPreference || !['EMAIL','WHATSAPP'].includes(channel) || !['MARKETING','RECEIPT'].includes(purpose)) return null;
  const preference = customer.communicationPreference;
  const email = channel === 'EMAIL';
  const allowed = preference[(purpose === 'MARKETING' ? 'marketing' : 'receipt') + (email ? 'Email' : 'Whatsapp')];
  const target = email ? customer.email : customer.phone;
  const proof = email ? preference.emailTargetHash : preference.phoneTargetHash;
  if (!allowed || !target || !(email ? customer.emailVerifiedAt : customer.phoneVerifiedAt) || proof !== exports.contactHash(target)) return null;
  return target;
};

exports.customerNotificationAllowed = async function customerNotificationAllowed(tx, notification) {
  const data = notification.data;
  if (!data?.customerCommunication) return true;
  if (data.customerCommunication !== 1 || typeof data.branchId !== 'string' || typeof data.customerId !== 'string' || !['MARKETING','RECEIPT'].includes(data.purpose)) return false;
  const branch = await tx.branch.findFirst({ where: { id: data.branchId, companyId: notification.companyId, isActive: true }, select: { id: true } });
  if (!branch) return false;
  const flags = await tx.featureFlag.findMany({ where: { companyId: notification.companyId, userId: null, key: 'customer_campaign', OR: [{ branchId: branch.id }, { branchId: null }] }, take: 3 });
  if (flags.filter((row) => row.branchId === branch.id).length > 1 || flags.filter((row) => row.branchId === null).length > 1) return false;
  const flag = flags.find((row) => row.branchId === branch.id) || flags.find((row) => row.branchId === null);
  if (!flag?.enabled) return false;
  if (data.purpose === 'MARKETING') {
    const campaign = await tx.customerCampaign.findFirst({ where: { id: data.campaignId, companyId: notification.companyId, branchId: branch.id, status: { in: ['ACTIVE','QUEUED'] } }, select: { id: true } });
    if (!campaign) return false;
  }
  const customer = await tx.customer.findFirst({ where: { id: data.customerId, companyId: notification.companyId }, include: { account: true, communicationPreference: true } });
  return exports.communicationRecipient(customer, notification.channel, data.purpose) === notification.recipient;
};

exports.processCustomerCampaignBatch = async function processCustomerCampaignBatch(tx, job) {
  if (job.sourceType !== 'CustomerCampaign' || !job.branchId) throw new Error('Invalid customer campaign job scope.');
  const campaign = await tx.customerCampaign.findFirst({ where: { id: job.sourceId, companyId: job.companyId, branchId: job.branchId } });
  if (!campaign || campaign.status === 'CANCELLED') return;
  const flags = await tx.featureFlag.findMany({ where: { companyId: campaign.companyId, userId: null, key: 'customer_campaign', OR: [{ branchId: campaign.branchId }, { branchId: null }] }, take: 3 });
  if (flags.filter((row) => row.branchId === campaign.branchId).length > 1 || flags.filter((row) => row.branchId === null).length > 1) throw new Error('Ambiguous campaign feature configuration.');
  if (!(flags.find((row) => row.branchId === campaign.branchId) || flags.find((row) => row.branchId === null))?.enabled) throw new Error('Customer campaign delivery is disabled.');
  const after = job.payload?.after;
  if (after && (typeof after.id !== 'string' || typeof after.createdAt !== 'string' || !Number.isFinite(Date.parse(after.createdAt)))) throw new Error('Invalid campaign cursor.');
  const rows = await tx.customer.findMany({ where: { companyId: campaign.companyId, createdAt: { lte: campaign.createdAt }, ...(after ? { OR: [{ createdAt: { gt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { gt: after.id } }] } : {}) }, include: { account: true, communicationPreference: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 });
  for (const customer of rows) {
    const recipient = exports.communicationRecipient(customer, campaign.channel, 'MARKETING');
    if (!recipient || await tx.customerCampaignDelivery.findUnique({ where: { campaignId_customerId: { campaignId: campaign.id, customerId: customer.id } } })) continue;
    const notification = await tx.notification.create({ data: { companyId: campaign.companyId, channel: campaign.channel, recipient, templateCode: campaign.templateCode, subject: campaign.subject, body: campaign.body, data: { customerCommunication: 1, purpose: 'MARKETING', branchId: campaign.branchId, customerId: customer.id, campaignId: campaign.id } } });
    await tx.customerCampaignDelivery.create({ data: { campaignId: campaign.id, customerId: customer.id, notificationId: notification.id } });
  }
  if (rows.length === 100) {
    const last = rows[rows.length - 1]; const cursor = { createdAt: last.createdAt.toISOString(), id: last.id };
    await tx.automationJob.upsert({ where: { companyId_idempotencyKey: { companyId: campaign.companyId, idempotencyKey: `campaign:${campaign.id}:${cursor.createdAt}:${cursor.id}` } }, update: {}, create: { companyId: campaign.companyId, branchId: campaign.branchId, eventType: 'customer.campaign.batch', sourceType: 'CustomerCampaign', sourceId: campaign.id, actionType: 'ENQUEUE_CUSTOMER_CAMPAIGN', payload: { after: cursor }, idempotencyKey: `campaign:${campaign.id}:${cursor.createdAt}:${cursor.id}` } });
  } else {
    await tx.customerCampaign.updateMany({ where: { id: campaign.id, status: 'ACTIVE' }, data: { status: 'QUEUED' } });
  }
};
