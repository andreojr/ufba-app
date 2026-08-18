import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { SigaaLinkService } from './sigaa-link.service';
import { SigaaEngineService } from './sigaa-engine.service';
import { SigaaCredentialsDto, SigaaLinkDto } from './sigaa-credentials.dto';
import { Turma } from './parsers/turmas-horario';

@Controller()
@UseGuards(JwtAuthGuard)
export class SigaaController {
  constructor(
    private readonly linkService: SigaaLinkService,
    private readonly engineService: SigaaEngineService,
  ) {}

  @Post('sigaa/link')
  async link(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaLinkDto,
  ): Promise<{ linked: true }> {
    await this.linkService.link(
      user.userId,
      { login: dto.login, senha: dto.senha },
      dto.rememberPassword ?? false,
    );
    return { linked: true };
  }

  // Credentials travel per-request in the body (never persisted by default —
  // see architecture notes); this is a deliberate deviation from strict REST
  // GET-has-no-body convention, not an architecture change.
  @Get('schedule')
  async schedule(@Body() dto: SigaaCredentialsDto): Promise<Turma[]> {
    return this.engineService.fetchSchedule({
      login: dto.login,
      senha: dto.senha,
    });
  }

  @Get('grades')
  grades(): Promise<never> {
    throw new NotImplementedException(
      'Grades parser (boletim.ts) is pending a real HTML fixture from a turma with grades already posted.',
    );
  }
}
