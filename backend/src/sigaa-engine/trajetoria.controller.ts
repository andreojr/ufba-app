import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import type { ItemPlano, TrajetoriaSalva } from './historico.repository';
import { HistoricoService } from './historico.service';
import type { Historico } from './parsers/historico';
import { SigaaCredentialsDto } from './sigaa-credentials.dto';

/**
 * `fetchedAt` is part of the payload on purpose. Once the eventual semester
 * cron lands it will only ever cover users on `syncMode: "cloud"` — the server
 * can never hold a device-mode credential — so the screen needs to be able to
 * say how old its data is, and the sync button stays permanent.
 */
export type TrajetoriaResponse =
  | { sincronizado: false }
  | { historico: Historico; fetchedAt: string; plano: ItemPlano[] };

function serializar(salva: TrajetoriaSalva): TrajetoriaResponse {
  return {
    historico: salva.historico,
    fetchedAt: salva.fetchedAt.toISOString(),
    plano: salva.plano,
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class TrajetoriaController {
  constructor(private readonly historicoService: HistoricoService) {}

  @Get('trajetoria')
  async get(@CurrentUser() user: RequestUser): Promise<TrajetoriaResponse> {
    const salva = await this.historicoService.getTrajetoria(user.userId);
    return salva ? serializar(salva) : { sincronizado: false };
  }

  // Credentials travel per-request in the body, same convention as /schedule:
  // a spec-compliant fetch client cannot send a body on a GET.
  @Post('trajetoria/sync')
  async sync(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<TrajetoriaResponse> {
    return serializar(
      await this.historicoService.sync(user.userId, {
        login: dto.login,
        senha: dto.senha,
      }),
    );
  }
}
