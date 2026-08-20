import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

/**
 * `/curriculo/meu-curso` takes the course name as a query param for now — it
 * does not yet read `User.curso` off the authenticated user. Wiring that in
 * is for whichever of roadmap items 4/5/8 becomes this endpoint's first real
 * consumer; the resolution logic itself (CurriculoService.resolverPorNomeUsuario)
 * is already what a future wiring would call.
 */
@Controller('curriculo')
@UseGuards(JwtAuthGuard)
export class CurriculoController {
  constructor(
    @Inject(CURRICULO_SERVICE) private readonly service: CurriculoService,
  ) {}

  @Get('cursos')
  async listarCursos(): Promise<CursoListaItem[]> {
    return this.service.listarCursos();
  }

  @Get('cursos/:cursoId')
  async buscarCurso(
    @Param('cursoId') cursoId: string,
  ): Promise<EstruturaCurricularSalva> {
    return this.service.resolverCurso(cursoId);
  }

  @Get('meu-curso')
  async meuCurso(
    @Query('curso') curso: string,
  ): Promise<EstruturaCurricularSalva> {
    return this.service.resolverPorNomeUsuario(curso);
  }
}
