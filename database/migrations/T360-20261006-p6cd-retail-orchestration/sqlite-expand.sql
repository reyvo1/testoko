-- AlterTable
ALTER TABLE "Order" ADD COLUMN "cashierShiftId" TEXT;
ALTER TABLE "Order" ADD COLUMN "createdById" TEXT;

-- AlterTable
ALTER TABLE "OperationalFinanceTransaction" ADD COLUMN "depositCashierShiftId" TEXT;

-- CreateTable
CREATE TABLE "RetailExchange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "replacementSaleId" TEXT NOT NULL,
    "cashierShiftId" TEXT NOT NULL,
    "refundAmount" DECIMAL NOT NULL,
    "replacementAmount" DECIMAL NOT NULL,
    "difference" DECIMAL NOT NULL,
    "operationKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomerCommunicationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "marketingEmail" BOOLEAN NOT NULL DEFAULT false,
    "marketingWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "receiptEmail" BOOLEAN NOT NULL DEFAULT false,
    "receiptWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" TEXT NOT NULL,
    "emailTargetHash" TEXT,
    "phoneTargetHash" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerCommunicationPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "operationKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CustomerCampaignDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CustomerCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "requestedById" TEXT,
    "scheduleId" TEXT,
    "scheduledFor" DATETIME,
    "reportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "filters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "leaseOwner" TEXT,
    "leaseExpiresAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "outputUrl" TEXT,
    "errorMessage" TEXT,
    "expiresAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReportJob" ("branchId", "companyId", "createdAt", "errorMessage", "expiresAt", "filters", "finishedAt", "format", "id", "outputUrl", "progress", "reportType", "requestedById", "scheduleId", "scheduledFor", "startedAt", "status", "updatedAt") SELECT "branchId", "companyId", "createdAt", "errorMessage", "expiresAt", "filters", "finishedAt", "format", "id", "outputUrl", "progress", "reportType", "requestedById", "scheduleId", "scheduledFor", "startedAt", "status", "updatedAt" FROM "ReportJob";
DROP TABLE "ReportJob";
ALTER TABLE "new_ReportJob" RENAME TO "ReportJob";
CREATE INDEX "ReportJob_companyId_status_createdAt_idx" ON "ReportJob"("companyId", "status", "createdAt");
CREATE INDEX "ReportJob_status_createdAt_idx" ON "ReportJob"("status", "createdAt");
CREATE INDEX "ReportJob_reportType_status_nextAttemptAt_idx" ON "ReportJob"("reportType", "status", "nextAttemptAt");
CREATE INDEX "ReportJob_scheduleId_createdAt_idx" ON "ReportJob"("scheduleId", "createdAt");
CREATE UNIQUE INDEX "ReportJob_scheduleId_scheduledFor_key" ON "ReportJob"("scheduleId", "scheduledFor");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
CREATE INDEX "Customer_companyId_createdAt_id_idx" ON "Customer"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_cashierShiftId_createdAt_idx" ON "Order"("cashierShiftId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationalFinanceTransaction_depositCashierShiftId_postedAt_idx" ON "OperationalFinanceTransaction"("depositCashierShiftId", "postedAt");

-- CreateIndex
CREATE INDEX "OperationalFinanceTransaction_companyId_branchId_counterpartyId_debitAccountCode_status_idx" ON "OperationalFinanceTransaction"("companyId", "branchId", "counterpartyId", "debitAccountCode", "status");
