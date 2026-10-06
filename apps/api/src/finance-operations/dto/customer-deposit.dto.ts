import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
export class CreateCustomerDepositDto {
  @IsString() customerId!: string;
  @IsString() @MaxLength(160) operationKey!: string;
  @IsString() @IsIn(['CREDIT','REFUND']) kind!: 'CREDIT' | 'REFUND';
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1000000000000) amount!: number;
  @IsString() settlementAccountCode!: string;
  @IsOptional() @IsString() depositAccountCode?: string;
  @IsOptional() @IsString() @MaxLength(160) externalRef?: string;
}
