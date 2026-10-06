-- AlterTable
ALTER TABLE "ReportJob" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cashierShiftId" TEXT,
ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "OperationalFinanceTransaction" ADD COLUMN     "depositCashierShiftId" TEXT;

-- CreateTable
CREATE TABLE "RetailExchange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "replacementSaleId" TEXT NOT NULL,
    "cashierShiftId" TEXT NOT NULL,
    "refundAmount" DECIMAL(65,30) NOT NULL,
    "replacementAmount" DECIMAL(65,30) NOT NULL,
    "difference" DECIMAL(65,30) NOT NULL,
    "operationKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetailExchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCommunicationPreference" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "marketingEmail" BOOLEAN NOT NULL DEFAULT false,
    "marketingWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "receiptEmail" BOOLEAN NOT NULL DEFAULT false,
    "receiptWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT NOT NULL,
    "emailTargetHash" TEXT,
    "phoneTargetHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCommunicationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "operationKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetailExchange_saleReturnId_key" ON "RetailExchange"("saleReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "RetailExchange_replacementSaleId_key" ON "RetailExchange"("replacementSaleId");

-- CreateIndex
CREATE INDEX "RetailExchange_companyId_branchId_createdAt_id_idx" ON "RetailExchange"("companyId", "branchId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RetailExchange_companyId_operationKey_key" ON "RetailExchange"("companyId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCommunicationPreference_customerId_key" ON "CustomerCommunicationPreference"("customerId");

-- CreateIndex
CREATE INDEX "CustomerCampaign_companyId_branchId_createdAt_id_idx" ON "CustomerCampaign"("companyId", "branchId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCampaign_companyId_operationKey_key" ON "CustomerCampaign"("companyId", "operationKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCampaignDelivery_notificationId_key" ON "CustomerCampaignDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "CustomerCampaignDelivery_customerId_createdAt_idx" ON "CustomerCampaignDelivery"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCampaignDelivery_campaignId_customerId_key" ON "CustomerCampaignDelivery"("campaignId", "customerId");

-- CreateIndex
CREATE INDEX "ReportJob_reportType_status_nextAttemptAt_idx" ON "ReportJob"("reportType", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Customer_companyId_createdAt_id_idx" ON "Customer"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_cashierShiftId_createdAt_idx" ON "Order"("cashierShiftId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalFinanceTransaction_depositCashierShiftId_postedA_idx" ON "OperationalFinanceTransaction"("depositCashierShiftId", "postedAt");

-- CreateIndex
CREATE INDEX "OperationalFinanceTransaction_companyId_branchId_counterpar_idx" ON "OperationalFinanceTransaction"("companyId", "branchId", "counterpartyId", "debitAccountCode", "status");

-- AddForeignKey
ALTER TABLE "CustomerCommunicationPreference" ADD CONSTRAINT "CustomerCommunicationPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCampaignDelivery" ADD CONSTRAINT "CustomerCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CustomerCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
