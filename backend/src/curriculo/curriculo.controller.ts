import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { CursoListaItem } from '../sigaa-engine/parsers/curso-lista';
import type { EstruturaCurricularSalva } from './curriculo.repository';
import type { VizinhosCurriculares } from './vizinhos-curriculares';
import { CurriculoService } from './curriculo.service';
import { CURRICULO_SERVICE } from './tokens';

/**
 * `/curriculo/meu-curso` takes the course name as a query param for now — it
 * does not yet read `User.curso` off the authenticated user. This endpoint
 * family has a real consumer (mobile's vizinhos curriculares screen, via
 * `getVizinhosCurriculares` in `mobile/src/lib/api.ts`, hitting
 * `/curriculo/meu-curso/componentes/:codigo/vizinhos` below), but that
 * consumer still passes `curso` as a query param itself rather than
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

  @Get('cursos/:cursoId/componentes/:codigo/vizinhos')
  async vizinhosCurriculares(
    @Param('cursoId') cursoId: string,
    @Param('codigo') codigo: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VizinhosCurriculares> {
    return this.service.vizinhosCurriculares(cursoId, codigo, user.userId);
  }

  @Get('meu-curso/componentes/:codigo/vizinhos')
  async vizinhosCurricularesMeuCurso(
    @Param('codigo') codigo: string,
    @Query('curso') curso: string | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<VizinhosCurriculares> {
    if (!curso) {
      throw new BadRequestException('Missing required query param "curso"');
    }
    return this.service.vizinhosCurricularesPorNomeUsuario(curso, codigo, user.userId);
  }
}
