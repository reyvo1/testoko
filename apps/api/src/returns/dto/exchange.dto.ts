import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateSaleDto } from '../../sales/dto/create-sale.dto';
import { ConfirmReturnDto } from './returns.dto';

export class CreateExchangeDto {
  @IsString() @MaxLength(160) operationKey!: string;
  @IsString() saleReturnId!: string;
  @IsString() cashierShiftId!: string;
  @IsNumber() expectedDifference!: number;
  @IsDefined() @ValidateNested() @Type(() => CreateSaleDto) replacement!: CreateSaleDto;
  @IsDefined() @ValidateNested() @Type(() => ConfirmReturnDto) confirmation!: ConfirmReturnDto;
}
