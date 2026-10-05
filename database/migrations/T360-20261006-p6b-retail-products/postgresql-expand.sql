ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "inventoryComponents" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "inventoryComponents" JSONB;
ALTER TABLE "SaleReturnItem" ADD COLUMN IF NOT EXISTS "inventoryComponents" JSONB;
ALTER TABLE "OrderReturnItem" ADD COLUMN IF NOT EXISTS "inventoryComponents" JSONB;
