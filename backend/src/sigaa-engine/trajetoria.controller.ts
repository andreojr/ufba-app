import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
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
import { SalvarPlanoDto } from './plano.dto';
import { SigaaCredentialsDto } from './sigaa-credentials.dto';

/**
 * Quanto a resposta do sync espera por marcos/projeção antes de desistir deles.
 *
 * Num curso de cache frio, `CurriculoService.resolverCurso` faz scraping ao
 * vivo e busca o detalhe de *todos* os componentes da estrutura, um por um —
 * sequencial de propósito, porque paralelizar corrompe a sessão JSF. Em
 * produção isso levou 37s e empurrou o POST /trajetoria/sync pra 44s, contra
 * os 45s de timeout do cliente: o histórico era parseado e gravado com
 * sucesso, e o app abandonava a requisição de todo jeito.
 *
 * Marcos e projeção são extras best-effort (ver `resolverCurriculo`), então
 * eles é que cedem — nunca o histórico, que é o conteúdo da tela.
 */
export const LIMITE_CURRICULO_MS = 8_000;

/** Estourou o limite acima; tratado como qualquer outra falha da estrutura. */
class CurriculoLentoError extends Error {
  constructor(ms: number) {
    super(`A estrutura curricular não resolveu em ${ms}ms.`);
    this.name = 'CurriculoLentoError';
  }
}

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
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
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
   * Corre `promessa` contra um limite de tempo — sem cancelá-la.
   *
   * Abandonar só a espera, e não o trabalho, é o ponto: o scraping segue até o
   * fim e grava a estrutura em cache, então a próxima leitura da tela já a
   * encontra pronta e devolve marcos e projeção na hora. Cancelar deixaria o
   * cache frio pra sempre e todo sync pagaria o limite inteiro à toa.
   */
  private async comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
    // Sem este catch, uma rejeição da promessa que perdeu a corrida viraria
    // unhandled rejection — ninguém mais está esperando por ela.
    promessa.catch(() => undefined);

    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promessa,
        new Promise<never>((_, rejeitar) => {
          timer = setTimeout(() => rejeitar(new CurriculoLentoError(ms)), ms);
        }),
      ]);
    } finally {
      // Sem isto o timer segura o event loop até o fim do limite mesmo quando
      // a estrutura resolveu rápido, que é o caso comum (cache quente).
      clearTimeout(timer);
    }
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
      const estrutura = await this.comLimite(
        this.curriculoService.resolverPorNomeUsuario(salva.historico.nomeCurso),
        LIMITE_CURRICULO_MS,
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

  @Put('trajetoria/plano')
  async salvarPlano(
    @CurrentUser() user: RequestUser,
    @Body() dto: SalvarPlanoDto,
  ): Promise<TrajetoriaResponse> {
    await this.historicoService.salvarPlano(user.userId, dto.itens);
    return this.get(user);
  }
}
