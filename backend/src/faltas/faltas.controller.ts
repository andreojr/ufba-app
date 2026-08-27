import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { DefinirFaltasDto } from './faltas.dto';
import { FaltasService, MatriculaNaoEncontradaError } from './faltas.service';

export interface FaltasResponse {
  faltas: number;
}

// Não há ValidationPipe global (ver main.ts) — sem isso, os decorators do DTO
// seriam decorativos. Mesmo precedente de PontoAtencaoController.
@Controller('turmas/:turmaId/faltas')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FaltasController {
  constructor(private readonly service: FaltasService) {}

  @Get()
  async buscar(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
  ): Promise<FaltasResponse> {
    return { faltas: await this.traduzir(this.service.buscar(user.userId, turmaId)) };
  }

  @Put()
  async definir(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
    @Body() dto: DefinirFaltasDto,
  ): Promise<FaltasResponse> {
    return {
      faltas: await this.traduzir(
        this.service.definir(user.userId, turmaId, dto.faltas),
      ),
    };
  }

  /**
   * `MatriculaNaoEncontradaError` é um erro de domínio (Error puro), e o
   * SigaaExceptionFilter só mapeia os erros do sigaa-engine — sem esta
   * tradução ele viraria 500 em vez do 403 que a tela sabe tratar.
   */
  private async traduzir(promessa: Promise<number>): Promise<number> {
    try {
      return await promessa;
    } catch (error) {
      if (error instanceof MatriculaNaoEncontradaError) {
        throw new ForbiddenException(error.message);
      }
      throw error;
    }
  }
}
