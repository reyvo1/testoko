import type { Prisma } from '@prisma/client';
export function contactHash(value: string | null | undefined): string;
export function communicationRecipient(customer: { account?: { isActive: boolean } | null; communicationPreference?: { marketingEmail: boolean; marketingWhatsapp: boolean; receiptEmail: boolean; receiptWhatsapp: boolean; emailTargetHash: string | null; phoneTargetHash: string | null } | null; email: string | null; phone: string | null; emailVerifiedAt: Date | null; phoneVerifiedAt: Date | null } | null, channel: string, purpose: string): string | null;
export function customerNotificationAllowed(tx: Prisma.TransactionClient, notification: { companyId: string; channel: string; recipient: string; data: Prisma.JsonValue | null }): Promise<boolean>;
export function processCustomerCampaignBatch(tx: Prisma.TransactionClient, job: { companyId: string; branchId: string | null; sourceType: string; sourceId: string; payload: Prisma.JsonValue }): Promise<void>;
