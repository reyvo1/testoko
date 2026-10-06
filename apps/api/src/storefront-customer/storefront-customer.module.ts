import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorefrontCustomerController } from './storefront-customer.controller';
import { StorefrontCustomerService } from './storefront-customer.service';
import { CustomerCommunicationsService } from './customer-communications.service';
import { CustomerCampaignController, CustomerCommunicationPreferenceController, CustomerReceiptDeliveryController } from './customer-communications.controller';

@Module({ imports: [PrismaModule], controllers: [StorefrontCustomerController, CustomerCampaignController, CustomerCommunicationPreferenceController, CustomerReceiptDeliveryController], providers: [StorefrontCustomerService, CustomerCommunicationsService], exports: [StorefrontCustomerService] })
export class StorefrontCustomerModule {}
