import { Injectable } from '@nestjs/common';
import { SigaaCredentials, SigaaSession } from './session';
import { parseTurmasHorario, Turma } from './parsers/turmas-horario';

const PORTAL_HOME_PATH = '/sigaa/portais/discente/discente.jsf';

export type SigaaSessionFactory = () => SigaaSession;

@Injectable()
export class SigaaEngineService {
  constructor(private readonly createSession: SigaaSessionFactory) {}

  /**
   * Logs in with the given credentials (never persisted by this method) and
   * returns the current semester's turmas + translated schedule, straight from
   * the portal home — no extra navigation needed (see spike).
   */
  async fetchSchedule(credentials: SigaaCredentials): Promise<Turma[]> {
    const session = this.createSession();
    await session.login(credentials);
    const html = await session.get(PORTAL_HOME_PATH);
    return parseTurmasHorario(html);
  }
}
