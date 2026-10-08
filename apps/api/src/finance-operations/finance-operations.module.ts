import { Module } from '@nestjs/common';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinanceOperationsController } from './finance-operations.controller';
import { FinanceOperationsService } from './finance-operations.service';
import { CustomerDepositController } from './customer-deposit.controller';
@Module({ imports: [PrismaModule, AccountingCoreModule], controllers: [FinanceOperationsController, CustomerDepositController], providers: [FinanceOperationsService] })
export class FinanceOperationsModule {}
