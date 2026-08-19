export interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  // Academic identity captured by the backend off the SIGAA portal home on
  // schedule fetches. Optional (not just nullable) because sessions stored by
  // older app versions won't carry these keys at all.
  matricula?: string | null;
  curso?: string | null;
  periodoIngresso?: string | null;
}

export interface Session {
  accessToken: string;
  user: GoogleUserInfo;
}

/** Where the user chose to keep their SIGAA credential: only on this device, or synced to the cloud. */
export type SyncMode = "device" | "cloud";

export interface SigaaCredentials {
  login: string;
  senha: string;
  syncMode: SyncMode;
}

/**
 * A freshly-minted SIGAA login session, meant to be handed to a WebView (not parsed
 * as data) so the user can browse the real sigaa.ufba.br already authenticated.
 * `sessionCookie` is the raw `JSESSIONID=<value>` pair — inject it into the WebView's
 * cookie store, don't send it as a plain request header (headers only apply to the
 * WebView's very first request, not to navigation the user triggers afterwards).
 */
export interface SigaaWebSession {
  sessionCookie: string;
  targetUrl: string;
}

/** One weekly occurrence of a turma — see backend TurmaSlot. */
export interface TurmaSlot {
  dia: string;
  inicioMin: number;
  fimMin: number;
  predio: string | null;
  sala: string | null;
  localOriginal: string;
}

/** A course the student is currently enrolled in, as scraped from the atestado de matrícula. */
export interface Turma {
  codigo: string | null;
  nome: string;
  /**
   * Null when the backend had to fall back to the portal home, which omits it.
   * Deliberately not rendered anywhere yet — captured because the atestado
   * hands it over for free, kept for whichever screen ends up wanting it.
   */
  docente: string | null;
  slots: TurmaSlot[];
  vigencia: { inicio: string; fim: string };
  semestre: string;
}

/**
 * The academic term itself: when it officially starts and ends, per the
 * atestado de matrícula. Distinct from a Turma's `vigencia` — that one is per
 * course. Dates are ISO (`YYYY-MM-DD`); build a Date from them with
 * `parseIsoDate` in lib/periodo-letivo, never `new Date(string)`, which reads
 * them as UTC midnight and lands on the previous day in Brazil.
 */
export interface PeriodoLetivo {
  semestre: string;
  inicio: string;
  fim: string;
}

/** What POST /schedule answers with. `periodoLetivo` is null on the portal-home fallback. */
export interface ScheduleResponse {
  turmas: Turma[];
  periodoLetivo: PeriodoLetivo | null;
}

/** Mirrors the backend's parser output — see backend/src/sigaa-engine/parsers/historico.ts. */
export interface ComponenteCursado {
  semestre: string;
  natureza: string | null;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  /** Null when the transcript printed "--": trancado or matriculado. */
  nota: number | null;
  situacao: string;
  docente: string | null;
}

export interface ComponentePendente {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  matriculado: boolean;
}

export interface ResumoCargaHoraria {
  exigida: number;
  integralizada: number;
  pendente: number;
}

export interface Historico {
  emitidoEm: string;
  curriculo: string;
  periodoLetivoAtual: number;
  prazoConclusaoPadrao: string;
  prazoConclusaoMaximo: string;
  indices: { cr: number | null; iap: number | null };
  cursados: ComponenteCursado[];
  pendentesObrigatorios: ComponentePendente[];
  cargaHoraria: {
    obrigatorias: ResumoCargaHoraria;
    optativas: ResumoCargaHoraria;
    complementares: ResumoCargaHoraria;
    total: ResumoCargaHoraria;
  };
  equivalencias: string[];
  observacoes: string[];
}

export interface ItemPlano {
  codigo: string;
  nome: string;
  cargaHoraria: number;
  semestre: string | null;
}

export type TrajetoriaResponse =
  | { sincronizado: false }
  | { historico: Historico; fetchedAt: string; plano: ItemPlano[] };
