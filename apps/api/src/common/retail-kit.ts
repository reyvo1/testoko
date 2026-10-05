import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readRetailPolicy } from './retail-policy';

export type KitComponent = { productId: string; quantityPerUnit: number; unitCost: string };
export type KitSnapshot = { version: 1; recipeId: string; recipeVersion: number; components: KitComponent[] };

export async function resolveKitSnapshot(client: Prisma.TransactionClient | PrismaService, companyId: string, product: { id: string; metadata?: Prisma.JsonValue | null; trackBatch?: boolean; trackSerial?: boolean; trackExpiry?: boolean }) {
  const policy = readRetailPolicy(product.metadata);
  if (!policy.kitRecipeId) return null;
  if (product.trackBatch || product.trackSerial || product.trackExpiry) throw new BadRequestException('Kit tracked memerlukan lineage khusus; tidak dapat dijual sebagai kit virtual.');
  const physicalBalance = await client.inventory.findFirst({ where: { productId: product.id, OR: [{ quantity: { not: 0 } }, { reserved: { not: 0 } }] }, select: { id: true } });
  if (physicalBalance) throw new BadRequestException('Kit virtual tidak boleh memiliki stok/reservasi parent fisik. Gunakan SKU terpisah atau nonaktifkan policy kit.');
  const recipe = await client.productionRecipe.findFirst({
    where: { id: policy.kitRecipeId, companyId, outputProductId: product.id, isActive: true },
    include: { items: { include: { componentProduct: true } } },
  });
  if (!recipe || !recipe.items.length || recipe.items.length > 100 || recipe.outputQtyPerBatch < 1) throw new BadRequestException('BOM kit tidak aktif/valid pada perusahaan ini.');
  const components = recipe.items.map((item) => {
    const component = item.componentProduct;
    const perUnit = item.quantityPerBatch / recipe.outputQtyPerBatch;
    if (component.id === product.id || component.companyId !== companyId || !component.isActive || component.productType !== 'PHYSICAL' || component.trackBatch || component.trackExpiry || component.trackSerial || readRetailPolicy(component.metadata).kitRecipeId || !new Prisma.Decimal(item.wastePct).isZero() || !Number.isSafeInteger(perUnit) || perUnit < 1) throw new BadRequestException('BOM kit membutuhkan bahan fisik aktif, non-tracked, non-kit, tanpa waste, dan rasio base unit integer.');
    return { productId: component.id, quantityPerUnit: perUnit, unitCost: component.costPrice.toString() };
  });
  return { version: 1, recipeId: recipe.id, recipeVersion: recipe.version, components } as KitSnapshot;
}

export function inventoryLines(item: { productId: string; quantity: number; inventoryComponents?: unknown }) {
  if (item.inventoryComponents == null) return [{ productId: item.productId, quantity: item.quantity }];
  const snapshot = item.inventoryComponents as KitSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.components) || !snapshot.components.length) throw new BadRequestException('Snapshot komponen kit tidak valid.');
  return snapshot.components.map((component) => {
    const quantity = component.quantityPerUnit * item.quantity;
    if (!component.productId || !Number.isSafeInteger(component.quantityPerUnit) || component.quantityPerUnit < 1 || !Number.isSafeInteger(quantity) || quantity < 1) throw new BadRequestException('Quantity snapshot komponen kit tidak aman.');
    return { productId: component.productId, quantity };
  });
}

export function kitUnitCost(snapshot: KitSnapshot) {
  return snapshot.components.reduce((sum, item) => sum.add(new Prisma.Decimal(item.unitCost).mul(item.quantityPerUnit)), new Prisma.Decimal(0));
}
