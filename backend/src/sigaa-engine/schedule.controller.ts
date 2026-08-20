import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { Turma } from './parsers/turma';
import type { HorarioSalvo } from './schedule.repository';
import { ScheduleService } from './schedule.service';
import { SigaaCredentialsDto } from './sigaa-credentials.dto';

/**
 * `fetchedAt` is part of the payload on purpose, same rationale as
 * TrajetoriaResponse: the screen needs to say how old its data is, and the
 * sync button stays permanent regardless of any future scheduled sync.
 */
export type ScheduleResponse =
  | { sincronizado: false }
  | { turmas: Turma[]; periodoLetivo: PeriodoLetivo | null; fetchedAt: string };

function serializar(salvo: HorarioSalvo): ScheduleResponse {
  return {
    turmas: salvo.turmas,
    periodoLetivo: salvo.periodoLetivo,
    fetchedAt: salvo.fetchedAt.toISOString(),
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('schedule')
  async get(@CurrentUser() user: RequestUser): Promise<ScheduleResponse> {
    const salvo = await this.scheduleService.getCached(user.userId);
    return salvo ? serializar(salvo) : { sincronizado: false };
  }

  // Credentials travel per-request in the body, same convention as
  // /trajetoria/sync: a spec-compliant fetch client cannot send a body on a GET.
  @Post('schedule/sync')
  async sync(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<ScheduleResponse> {
    return serializar(
      await this.scheduleService.sync(user.userId, {
        login: dto.login,
        senha: dto.senha,
      }),
    );
  }
}
