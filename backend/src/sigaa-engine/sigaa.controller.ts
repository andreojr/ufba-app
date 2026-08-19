import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotImplementedException,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { UserRepository } from '../users/user.repository';
import { USER_REPOSITORY } from '../db/tokens';
import { SigaaLinkService } from './sigaa-link.service';
import { SigaaEngineService, SigaaWebSession } from './sigaa-engine.service';
import { SigaaCredentialsDto, SigaaLinkDto } from './sigaa-credentials.dto';
import { Turma } from './parsers/turma';
import { PeriodoLetivo } from './parsers/atestado-turmas';

/**
 * What GET-equivalent /schedule answers with. `periodoLetivo` is null when the
 * schedule had to be read off the portal home instead of the atestado de
 * matrícula — see SigaaEngineService.fetchSchedule.
 */
export interface ScheduleResponse {
  turmas: Turma[];
  periodoLetivo: PeriodoLetivo | null;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class SigaaController {
  private readonly logger = new Logger(SigaaController.name);

  constructor(
    private readonly linkService: SigaaLinkService,
    private readonly engineService: SigaaEngineService,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
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

  @Get('sigaa/link')
  async getLink(
    @CurrentUser() user: RequestUser,
  ): Promise<
    { linked: false } | { linked: true; login: string; senha: string }
  > {
    return this.linkService.getLinkedCredentials(user.userId);
  }

  // Credentials travel per-request in the body (never persisted by default —
  // see architecture notes). POST (not GET) because a spec-compliant fetch
  // client cannot send a body on a GET request.
  @Post('schedule')
  async schedule(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<ScheduleResponse> {
    const { turmas, perfil, periodoLetivo } =
      await this.engineService.fetchSchedule({
        login: dto.login,
        senha: dto.senha,
      });

    // The perfil is an opportunistic capture off the same page — saving it
    // must never turn a perfectly good schedule fetch into an error.
    try {
      await this.userRepository.updateSigaaProfile(user.userId, perfil);
    } catch (error) {
      this.logger.warn(
        `Failed to save the SIGAA profile for user ${user.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return { turmas, periodoLetivo };
  }

  // Logs in and hands back the raw SIGAA session cookie (not our own parsed data)
  // so the mobile client can open the real sigaa.ufba.br site — in a WebView, cookie
  // injected into its cookie jar — already authenticated. Different consumer than
  // /schedule: that one drives navigation itself over HTTP; this one hands off to an
  // actual browser engine, which is why a cookie (not a data payload) is returned.
  @Post('sigaa/session')
  async session(@Body() dto: SigaaCredentialsDto): Promise<SigaaWebSession> {
    return this.engineService.createWebSession({
      login: dto.login,
      senha: dto.senha,
    });
  }

  // Same credentials-in-body convention as /schedule. Returns the transcript
  // PDF straight from SIGAA (see SigaaEngineService.fetchHistorico) — unlike
  // /sigaa/session this doesn't hand off to a WebView, it streams the bytes.
  @Post('sigaa/historico')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="historico.pdf"')
  async historico(@Body() dto: SigaaCredentialsDto): Promise<StreamableFile> {
    const pdf = await this.engineService.fetchHistorico({
      login: dto.login,
      senha: dto.senha,
    });
    return new StreamableFile(pdf);
  }

  // Same credentials-in-body convention as /schedule. Unlike /sigaa/historico
  // (a real PDF byte stream), SIGAA only serves the atestado as a print-ready
  // HTML page, so this returns a self-contained HTML document (assets inlined,
  // scripts stripped) for the client to render to a PDF on the device via
  // expo-print — see SigaaEngineService.fetchAtestado.
  @Post('sigaa/atestado')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async atestado(@Body() dto: SigaaCredentialsDto): Promise<string> {
    return this.engineService.fetchAtestado({
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
