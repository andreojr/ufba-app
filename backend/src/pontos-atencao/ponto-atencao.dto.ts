import {
  IsIn,
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

  /**
   * YYYY-MM-DD; a hora, quando existe, vem separada. `@IsISO8601` aceitava um
   * datetime completo ("2026-09-22T10:00:00Z"), que `paraData` concatenava
   * com um segundo "T00:00:00Z" e virava uma Date inválida — 500 em vez de
   * 400. O formato de data pura é a única entrada válida.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
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

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
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
