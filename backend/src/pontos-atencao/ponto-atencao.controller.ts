import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import {
  AtualizarPontoAtencaoDto,
  CriarPontoAtencaoDto,
  VotarDto,
} from './ponto-atencao.dto';
import { PontoAtencaoService } from './ponto-atencao.service';
import type { PontoAtencaoVisao } from './ponto-atencao.service';

/**
 * O id do responsável não sai daqui — a tela mostra o nome, e devolver o id
 * só daria a um cliente a chance de cruzar autoria entre turmas.
 */
export interface PontoAtencaoResponse {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  tipo: 'PROVA' | 'TRABALHO';
  titulo: string;
  data: string;
  hora: string | null;
  observacao: string | null;
  responsavel: { nome: string } | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: 'CONFIRMA' | 'CONTESTA' | null;
  estado: 'NORMAL' | 'CONTESTADO';
  podeEditar: boolean;
  podeApagar: boolean;
}

function serializar(visao: PontoAtencaoVisao): PontoAtencaoResponse {
  return {
    id: visao.id,
    turmaId: visao.turmaId,
    turmaCodigo: visao.turmaCodigo,
    turmaNome: visao.turmaNome,
    tipo: visao.tipo,
    titulo: visao.titulo,
    data: visao.data.toISOString().slice(0, 10),
    hora: visao.hora,
    observacao: visao.observacao,
    responsavel: visao.responsavelNome ? { nome: visao.responsavelNome } : null,
    confirmacoes: visao.confirmacoes,
    contestacoes: visao.contestacoes,
    meuVoto: visao.meuVoto,
    estado: visao.estado,
    podeEditar: visao.podeEditar,
    podeApagar: visao.podeApagar,
  };
}

// Não há ValidationPipe global (ver main.ts) — sem isso, os decorators do DTO
// seriam decorativos. DocentesController é o precedente para aplicar o pipe
// por controller; não remova esta linha como "limpeza", ela é o que valida e
// faz whitelist do body — o comportamento está fixado em ponto-atencao.dto.spec.ts.
@Controller('pontos-atencao')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class PontoAtencaoController {
  constructor(private readonly service: PontoAtencaoService) {}

  @Get()
  async listar(
    @CurrentUser() user: RequestUser,
    @Query('desde') desde: string | undefined,
  ): Promise<PontoAtencaoResponse[]> {
    const visoes = await this.service.listar(user.userId, desde === 'vencidos');
    return visoes.map(serializar);
  }

  @Post()
  async criar(
    @CurrentUser() user: RequestUser,
    @Body() dto: CriarPontoAtencaoDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(
      await this.service.criar(user.userId, dto.turmaId, {
        tipo: dto.tipo,
        titulo: dto.titulo,
        data: dto.data,
        hora: dto.hora ?? null,
        observacao: dto.observacao ?? null,
      }),
    );
  }

  @Patch(':id')
  async atualizar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AtualizarPontoAtencaoDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(
      await this.service.atualizar(user.userId, id, {
        tipo: dto.tipo,
        titulo: dto.titulo,
        data: dto.data,
        hora: dto.hora ?? null,
        observacao: dto.observacao ?? null,
      }),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async apagar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.apagar(user.userId, id);
  }

  @Put(':id/voto')
  async votar(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: VotarDto,
  ): Promise<PontoAtencaoResponse> {
    return serializar(await this.service.votar(user.userId, id, dto.valor));
  }

  @Delete(':id/voto')
  async removerVoto(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PontoAtencaoResponse> {
    return serializar(await this.service.removerVoto(user.userId, id));
  }
}
