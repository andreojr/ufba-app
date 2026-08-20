import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import type { ArvoreDependencias } from './arvore-dependencias';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

/**
 * `/curriculo/meu-curso` takes the course name as a query param for now — it
 * does not yet read `User.curso` off the authenticated user. This endpoint
 * family now has a real consumer (mobile's árvore de dependências screen,
 * via `getArvoreDependencias` in `mobile/src/lib/api.ts`, hitting
 * `/curriculo/meu-curso/componentes/:codigo/arvore-dependencias` below), but
 * that consumer still passes `curso` as a query param itself rather than
 * resolving `User.curso` server-side — that wiring is still not done.
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
    @Query('curso') curso: string | undefined,
  ): Promise<EstruturaCurricularSalva> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.resolverPorNomeUsuario(curso);
  }

  @Get('cursos/:cursoId/componentes/:codigo/arvore-dependencias')
  async arvoreDependencias(
    @Param('cursoId') cursoId: string,
    @Param('codigo') codigo: string,
  ): Promise<ArvoreDependencias> {
    return this.service.arvoreDependencias(cursoId, codigo);
  }

  @Get('meu-curso/componentes/:codigo/arvore-dependencias')
  async arvoreDependenciasMeuCurso(
    @Param('codigo') codigo: string,
    @Query('curso') curso: string | undefined,
  ): Promise<ArvoreDependencias> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.arvoreDependenciasPorNomeUsuario(curso, codigo);
  }
}
