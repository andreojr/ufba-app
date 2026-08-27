import {
  Body,
  Controller,
  ForbiddenException,
  Logger,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { PrismaService } from '../db/prisma.service';
import { PontoAtencaoService } from '../pontos-atencao/ponto-atencao.service';
import { SigaaCredentialsDto } from './sigaa-credentials.dto';
import { TurmaVirtualFeed, TurmaVirtualService } from './turma-virtual.service';
import type { NoticiaDetalhe } from './parsers/turma-virtual/noticia-detalhe';

/**
 * Avaliações são oficiais (o professor marcou no SIGAA) — o app converte pra
 * Ponto de Atenção e não repete a mesma informação aqui, pra não duplicar a
 * fonte de verdade. Ver PontoAtencaoService.sincronizarDaTurmaVirtual.
 */
export type TurmaVirtualFeedResposta = Omit<TurmaVirtualFeed, 'avaliacoes'>;

/**
 * Mesma checagem de posse que PontoAtencaoService.exigirMatricula: consultar
 * o SIGAA de outro aluno com um id de turma alheio seria só trocar o :id na
 * URL sem essa guarda.
 */
async function exigirMatricula(
  prisma: PrismaService,
  userId: string,
  turmaId: string,
): Promise<void> {
  const matricula = await prisma.matricula.findUnique({
    where: { userId_turmaId: { userId, turmaId } },
    select: { turmaId: true },
  });
  if (!matricula) {
    throw new ForbiddenException('Você não está matriculado nesta turma.');
  }
}

// Não há ValidationPipe global (ver main.ts) — sem isso, os decorators do DTO
// seriam decorativos. Mesmo precedente de PontoAtencaoController.
@Controller('turmas/:turmaId/turma-virtual')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class TurmaVirtualController {
  private readonly logger = new Logger(TurmaVirtualController.name);

  constructor(
    private readonly service: TurmaVirtualService,
    private readonly prisma: PrismaService,
    private readonly pontoAtencaoService: PontoAtencaoService,
  ) {}

  // Credenciais no corpo, mesma convenção de /schedule/sync: aqui também é
  // uma raspagem SIGAA sob demanda, não uma leitura de cache.
  @Post()
  async getFeed(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<TurmaVirtualFeedResposta> {
    await exigirMatricula(this.prisma, user.userId, turmaId);
    const { avaliacoes, ...resto } = await this.service.getFeed(turmaId, {
      login: dto.login,
      senha: dto.senha,
    });
    // Best-effort: a Turma Virtual em si já leu com sucesso — um formato de
    // data inesperado nas avaliações não pode derrubar noticias/tópicos, que
    // já estão prontos pra responder.
    try {
      await this.pontoAtencaoService.sincronizarDaTurmaVirtual(
        user.userId,
        turmaId,
        avaliacoes,
      );
    } catch (error) {
      this.logger.warn(
        `Falha ao sincronizar avaliações da turma ${turmaId} em Pontos de Atenção`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return resto;
  }

  @Post('noticias/:noticiaId')
  async getNoticiaDetalhe(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
    @Param('noticiaId') noticiaId: string,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<NoticiaDetalhe> {
    await exigirMatricula(this.prisma, user.userId, turmaId);
    return this.service.getNoticiaDetalhe(turmaId, noticiaId, {
      login: dto.login,
      senha: dto.senha,
    });
  }
}
