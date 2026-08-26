import {
  Body,
  Controller,
  ForbiddenException,
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
import { SigaaCredentialsDto } from './sigaa-credentials.dto';
import { TurmaVirtualFeed, TurmaVirtualService } from './turma-virtual.service';
import type { NoticiaDetalhe } from './parsers/turma-virtual/noticia-detalhe';

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
  constructor(
    private readonly service: TurmaVirtualService,
    private readonly prisma: PrismaService,
  ) {}

  // Credenciais no corpo, mesma convenção de /schedule/sync: aqui também é
  // uma raspagem SIGAA sob demanda, não uma leitura de cache.
  @Post()
  async getFeed(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<TurmaVirtualFeed> {
    await exigirMatricula(this.prisma, user.userId, turmaId);
    return this.service.getFeed(turmaId, { login: dto.login, senha: dto.senha });
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
