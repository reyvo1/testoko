import { IsBoolean, IsIn, IsString, MaxLength } from 'class-validator';
export class CommunicationPreferenceDto {
  @IsString() @MaxLength(160) operationKey!: string;
  @IsBoolean() marketingEmail!: boolean;
  @IsBoolean() marketingWhatsapp!: boolean;
  @IsBoolean() receiptEmail!: boolean;
  @IsBoolean() receiptWhatsapp!: boolean;
}
export class CreateCustomerCampaignDto {
  @IsString() @MaxLength(160) operationKey!: string;
  @IsString() @IsIn(['EMAIL','WHATSAPP']) channel!: string;
  @IsString() @MaxLength(100) templateCode!: string;
}
export class QueueCustomerReceiptDto {
  @IsString() @MaxLength(160) operationKey!: string;
  @IsString() @IsIn(['EMAIL','WHATSAPP']) channel!: string;
}
export class CancelCustomerCampaignDto {
  @IsString() @MaxLength(160) operationKey!: string;
}
