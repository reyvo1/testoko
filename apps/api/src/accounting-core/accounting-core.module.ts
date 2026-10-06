import { TaxExportsService } from './tax-exports.service';
import { TaxExportsController } from './tax-exports.controller';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingCoreController } from './accounting-core.controller';
import { AccountingCoreService } from './accounting-core.service';

@Module({ imports: [PrismaModule], controllers: [AccountingCoreController, TaxExportsController], providers: [AccountingCoreService, TaxExportsService], exports: [AccountingCoreService] })
export class AccountingCoreModule {}
