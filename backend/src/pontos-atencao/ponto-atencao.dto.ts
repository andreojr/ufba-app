import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CriarPontoAtencaoDto {
  @IsString()
  turmaId!: string;

  @IsIn(['PROVA', 'TRABALHO'])
  tipo!: 'PROVA' | 'TRABALHO';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  titulo!: string;

  /** YYYY-MM-DD; a hora, quando existe, vem separada. */
  @IsISO8601({ strict: true })
  data!: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  observacao?: string;
}

export class AtualizarPontoAtencaoDto {
  @IsIn(['PROVA', 'TRABALHO'])
  tipo!: 'PROVA' | 'TRABALHO';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  titulo!: string;

  @IsISO8601({ strict: true })
  data!: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  observacao?: string;
}

export class VotarDto {
  @IsIn(['CONFIRMA', 'CONTESTA'])
  valor!: 'CONFIRMA' | 'CONTESTA';
}
