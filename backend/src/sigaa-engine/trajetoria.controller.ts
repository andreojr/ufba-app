import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { CURRICULO_SERVICE } from '../curriculo/tokens';
import type { CurriculoService } from '../curriculo/curriculo.service';
import {
  montarMarcosResponse,
  type MarcosResponse,
} from '../curriculo/marcos-semestralizacao';
import {
  montarProjecao,
  type ProjecaoResponse,
} from '../curriculo/projecao-trajetoria';
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
  | {
      historico: Historico;
      fetchedAt: string;
      plano: ItemPlano[];
      /**
       * Null whenever the aluno's curso can't be resolved yet (course name
       * fuzzy-match miss, no "Ativa" estrutura, or a transient scraping
       * failure) — a best-effort extra, never worth failing the whole
       * Trajetória screen over.
       */
      marcos: MarcosResponse | null;
      /**
       * Null pelos mesmos motivos que `marcos`: sem estrutura curricular
       * resolvida não há período de onde inferir nada. A tela cai na linha do
       * tempo só-passado.
       */
      projecao: ProjecaoResponse | null;
    };

@Controller()
@UseGuards(JwtAuthGuard)
export class TrajetoriaController {
  private readonly logger = new Logger(TrajetoriaController.name);

  constructor(
    private readonly historicoService: HistoricoService,
    @Inject(CURRICULO_SERVICE)
    private readonly curriculoService: CurriculoService,
  ) {}

  private async serializar(
    salva: TrajetoriaSalva,
  ): Promise<TrajetoriaResponse> {
    const { marcos, projecao } = await this.resolverCurriculo(salva);
    return {
      historico: salva.historico,
      fetchedAt: salva.fetchedAt.toISOString(),
      plano: salva.plano,
      marcos,
      projecao,
    };
  }

  /**
   * Marcos e projeção saem da mesma estrutura curricular, então são resolvidos
   * juntos: separá-los custaria um segundo `resolverPorNomeUsuario` por leitura
   * de tela. Falha em qualquer um dos dois derruba os dois — ambos são extras
   * best-effort, e uma tela com marcos mas sem projeção não é um estado que
   * valha a pena existir.
   */
  private async resolverCurriculo(salva: TrajetoriaSalva): Promise<{
    marcos: MarcosResponse | null;
    projecao: ProjecaoResponse | null;
  }> {
    try {
      const estrutura = await this.curriculoService.resolverPorNomeUsuario(
        salva.historico.nomeCurso,
      );
      const marcos = montarMarcosResponse(estrutura, salva.historico);
      return {
        marcos,
        projecao: montarProjecao(
          estrutura,
          salva.historico,
          marcos,
          salva.plano,
        ),
      };
    } catch (erro) {
      this.logger.warn(
        `Não foi possível resolver a estrutura curricular do aluno: ${erro}`,
      );
      return { marcos: null, projecao: null };
    }
  }

  @Get('trajetoria')
  async get(@CurrentUser() user: RequestUser): Promise<TrajetoriaResponse> {
    const salva = await this.historicoService.getTrajetoria(user.userId);
    return salva ? this.serializar(salva) : { sincronizado: false };
  }

  // Credentials travel per-request in the body, same convention as /schedule:
  // a spec-compliant fetch client cannot send a body on a GET.
  @Post('trajetoria/sync')
  async sync(
    @CurrentUser() user: RequestUser,
    @Body() dto: SigaaCredentialsDto,
  ): Promise<TrajetoriaResponse> {
    return this.serializar(
      await this.historicoService.sync(user.userId, {
        login: dto.login,
        senha: dto.senha,
      }),
    );
  }
}
