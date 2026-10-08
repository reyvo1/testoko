import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsString, MaxLength } from 'class-validator';

export class RetailProductDto {
  @ApiProperty({ description: 'Stable operation key for same-payload retries.' }) @IsString() @MaxLength(160) operationKey!: string;
  @ApiProperty({ description: 'Opt-in gallery, weight barcode policy, and canonical kitRecipeId. Omitted policies are disabled.' }) @IsObject() policy!: Record<string, unknown>;
}
