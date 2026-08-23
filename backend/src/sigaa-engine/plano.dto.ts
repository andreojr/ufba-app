import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsString,
  Matches,
  ValidateIf,
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
  //
  // `ValidateIf` em vez de `IsOptional`: a chave é obrigatória, só o valor
  // `null` é dispensado da validação de formato. Com `IsOptional` um corpo sem
  // a chave passava, e aí `semestre === null` era falso — o item escapava do
  // `deleteMany` e chegava ao `upsert` com `undefined`.
  @ValidateIf((o: ItemPlanoDto) => o.semestre !== null)
  @Matches(/^\d{4}\.[12]$/)
  semestre!: string | null;
}

export class SalvarPlanoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemPlanoDto)
  itens!: ItemPlanoDto[];
}
