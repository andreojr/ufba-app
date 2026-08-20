import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class TurmaDocenteDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsString()
  docente!: string;
}

export class SemestreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TurmaDocenteDto)
  turmas!: TurmaDocenteDto[];
}
