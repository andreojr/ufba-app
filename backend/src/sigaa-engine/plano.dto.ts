import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class ItemPlanoDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsInt()
  cargaHoraria!: number;

  // "AAAA.N", ou null para tirar a matéria da posição escolhida. O formato é
  // validado aqui porque o projetor faz aritmética em cima dele.
  @IsOptional()
  @Matches(/^\d{4}\.[12]$/)
  semestre!: string | null;
}

export class SalvarPlanoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemPlanoDto)
  itens!: ItemPlanoDto[];
}
