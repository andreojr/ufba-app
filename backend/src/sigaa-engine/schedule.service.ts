import { Logger } from '@nestjs/common';
import type { DiscentePerfil } from './parsers/discente-perfil';
import type { PeriodoLetivo } from './parsers/atestado-turmas';
import type { Turma } from './parsers/turma';
import type { HorarioSalvo, ScheduleRepository } from './schedule.repository';

interface Credenciais {
  login: string;
  senha: string;
}

/** Just the slice of SigaaEngineService this service needs. */
interface DownloaderSchedule {
  fetchSchedule(credenciais: Credenciais): Promise<{
    turmas: Turma[];
    perfil: DiscentePerfil;
    periodoLetivo: PeriodoLetivo | null;
  }>;
}

/** Just the slice of UserRepository this service needs. */
interface PerfilRepository {
  updateSigaaProfile(userId: string, perfil: DiscentePerfil): Promise<void>;
}

export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly downloader: DownloaderSchedule,
    private readonly userRepository: PerfilRepository,
    private readonly repository: ScheduleRepository,
  ) {}

  /**
   * The whole sync, in order: download, persist. The perfil save is
   * opportunistic — a failure there must never turn a perfectly good schedule
   * fetch into an error, same convention as the old POST /schedule handler.
   */
  async sync(userId: string, credenciais: Credenciais): Promise<HorarioSalvo> {
    const { turmas, perfil, periodoLetivo } =
      await this.downloader.fetchSchedule(credenciais);

    // An empty scrape almost never means "the student really has zero
    // turmas" — it means SIGAA answered with something the parsers couldn't
    // read (maintenance, matrícula processing, a markup change). salvar()
    // replaces the whole snapshot, so applying this blindly would wipe out a
    // perfectly good previous sync with nothing recoverable. Only trust an
    // empty result when there was nothing cached before either — that's a
    // legitimate "first sync" or "off term" state, not data loss.
    if (turmas.length === 0) {
      const anterior = await this.repository.buscar(userId);
      if (anterior && anterior.turmas.length > 0) {
        this.logger.warn(
          `SIGAA sync for ${userId} returned 0 turmas but ${anterior.turmas.length} were cached — refusing to overwrite, keeping the previous snapshot.`,
        );
        throw new Error(
          'O SIGAA não retornou nenhuma turma nesta sincronização; o horário salvo anteriormente foi mantido.',
        );
      }
    }

    try {
      await this.userRepository.updateSigaaProfile(userId, perfil);
    } catch (error) {
      this.logger.warn(
        `Failed to save the SIGAA profile for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.repository.salvar(userId, turmas, periodoLetivo);

    this.logger.log(`Horário sincronizado para ${userId}: ${turmas.length} turmas`);

    const salvo = await this.repository.buscar(userId);
    if (!salvo) {
      throw new Error('Horário salvo mas não encontrado logo depois.');
    }
    return salvo;
  }

  /** Null means the user has never synced — the screen's fallback state. */
  async getCached(userId: string): Promise<HorarioSalvo | null> {
    return this.repository.buscar(userId);
  }
}
