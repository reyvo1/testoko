import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';
export class ApproveTaxExportMappingDto {
  @IsString() @IsNotEmpty() @MaxLength(120) operationKey!: string;
  @IsIn(['FAKTUR_PK_1_4','BPPU_2024_11']) contract!: 'FAKTUR_PK_1_4' | 'BPPU_2024_11';
  @IsObject() mapping!: Record<string, unknown>;
}
export class CreateTaxExportDto {
  @IsString() @IsNotEmpty() @MaxLength(120) operationKey!: string;
  @IsIn(['FAKTUR_PK_1_4','BPPU_2024_11']) contract!: 'FAKTUR_PK_1_4' | 'BPPU_2024_11';
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) documentIds!: string[];
}
