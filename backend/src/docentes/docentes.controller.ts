import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { DocenteSalvo } from './docente.repository';
import { DocentesService, type DocenteResumo } from './docentes.service';
import { SemestreDto } from './semestre.dto';

@Controller('docentes')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class DocentesController {
  constructor(private readonly service: DocentesService) {}

  /**
   * POST, not GET, for the same reason /schedule is: the client sends a list in
   * the body, and a spec-compliant fetch cannot put a body on a GET.
   *
   * No user scoping: the response is public data, identical for every student.
   */
  @Post('semestre')
  async semestre(@Body() dto: SemestreDto): Promise<DocenteResumo[]> {
    // A turma with no docente on the atestado is its own empty state and the
    // client renders it locally — nothing to resolve here.
    const turmas = dto.turmas.filter((t) => t.docente.trim().length > 0);
    return this.service.resumoDoSemestre(turmas);
  }

  @Get(':siape')
  async detalhe(@Param('siape') siape: string): Promise<DocenteSalvo> {
    const docente = await this.service.perfil(siape);
    if (!docente) {
      throw new NotFoundException(`No cached profile for siape ${siape}`);
    }
    return docente;
  }
}
