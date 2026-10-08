ALTER TABLE "SaleItem" ADD COLUMN "inventoryComponents" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "inventoryComponents" JSONB;
ALTER TABLE "SaleReturnItem" ADD COLUMN "inventoryComponents" JSONB;
ALTER TABLE "OrderReturnItem" ADD COLUMN "inventoryComponents" JSONB;
