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
  /**
   * True once SIGAA rejected this password — the student changed it there and
   * hasn't updated it here yet. Optional (not just `false`) because credentials
   * stored by older app versions won't carry the key at all.
   */
  senhaDesatualizada?: boolean;
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
  /** Identidade compartilhada da turma — é o que liga um ponto de atenção a ela. */
  id: string;
  /** A coluna "Turma" do atestado ("02"), parte da chave natural. */
  numero: string;
  codigo: string | null;
  nome: string;
  /**
   * Null when the backend had to fall back to the portal home, which omits it.
   * This is what the Professores tab sends to POST /docentes/semestre to
   * resolve each professor's public profile.
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

/**
 * What GET /schedule and POST /schedule/sync answer with. `periodoLetivo` is
 * null on the portal-home fallback. `sincronizado: false` is the fallback
 * state for a user who has never synced — GET reads the cache and finds
 * nothing yet, the same shape TrajetoriaResponse uses.
 */
export type ScheduleResponse =
  | { sincronizado: false }
  | { turmas: Turma[]; periodoLetivo: PeriodoLetivo | null; fetchedAt: string };

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
  nomeCurso: string;
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

/** One milestone on the workload progress bar — mirrors backend MarcoSemestre. */
export interface MarcoSemestre {
  periodo: number;
  cargaHorariaAcumulada: number;
  percentual: number;
}

/** Whether the aluno is ahead, on pace, or behind the grade's expected semestralização — mirrors backend Ritmo. */
export type Ritmo = "adiantado" | "no_ritmo" | "atrasado";

/** Mirrors backend MarcosResponse — see backend/src/curriculo/marcos-semestralizacao.ts. */
export interface MarcosSemestralizacao {
  marcos: MarcoSemestre[];
  ritmo: Ritmo | null;
  obsoletas: string[];
  equivalencias: { codigo: string; equivalenteDe: string }[];
}

export type TrajetoriaResponse =
  | { sincronizado: false }
  | {
      historico: Historico;
      fetchedAt: string;
      plano: ItemPlano[];
      /** Null when the aluno's curso couldn't be resolved yet — best-effort extra. */
      marcos: MarcosSemestralizacao | null;
    };

/** Mirrors the backend's DocenteSelos — see backend/src/docentes/selos.ts. */
export interface DocenteSelos {
  contato: boolean;
  formacao: boolean;
  areasInteresse: boolean;
  lattes: boolean;
  orientacoes: boolean;
  semestresLecionando: number;
}

/** Mirrors POST /docentes/semestre's response item — see backend DocentesService.resumoDoSemestre. */
export interface DocenteResumo {
  nomeOriginal: string;
  componentes: { codigo: string; nome: string }[];
  perfil: null | {
    siape: string;
    nome: string;
    departamento: string | null;
    unidade: string | null;
    selos: DocenteSelos;
  };
}

/** Mirrors one entry of DocentePerfil.disciplinas — see backend/src/sigaa-engine/parsers/docente-disciplinas.ts. */
export interface DocenteDisciplina {
  semestre: string;
  codigo: string;
  nome: string;
  cargaHoraria: number;
  horario: string;
}

/** Mirrors GET /docentes/:siape's response — see backend/src/docentes/docentes.service.ts. */
export interface DocentePerfil {
  siape: string;
  nome: string;
  departamento: string | null;
  unidade: string | null;
  descricaoPessoal: string | null;
  formacao: string[];
  areasInteresse: string[];
  lattesUrl: string | null;
  enderecoProfissional: string | null;
  sala: string | null;
  telefone: string | null;
  email: string | null;
  disciplinas: DocenteDisciplina[];
  tccsOrientados: { titulo: string; ano: number }[];
  orientacoes: {
    mestradoAndamento: number;
    mestradoConcluidas: number;
    doutoradoAndamento: number;
    doutoradoConcluidas: number;
  };
}

export type SituacaoVizinho = "cursada" | "emCurso" | "liberada" | "bloqueada";

export interface VizinhoCurricular {
  codigo: string;
  nome: string;
  situacao: SituacaoVizinho;
}

export interface VizinhosCurricularesResponse {
  atual: VizinhoCurricular;
  preRequisitos: VizinhoCurricular[];
  desbloqueia: VizinhoCurricular[];
}

export type TipoPonto = "PROVA" | "TRABALHO";
export type ValorVoto = "CONFIRMA" | "CONTESTA";

/**
 * Um prazo cadastrado por um aluno e visível para a turma inteira. `estado`
 * vem derivado do backend: CONTESTADO sai da contagem regressiva e do bloco
 * do dia, e só aparece na lista completa.
 */
export interface PontoAtencao {
  id: string;
  turmaId: string;
  turmaCodigo: string | null;
  turmaNome: string;
  tipo: TipoPonto;
  titulo: string;
  /** YYYY-MM-DD — usar parseIsoDate, nunca new Date(string). */
  data: string;
  hora: string | null;
  observacao: string | null;
  responsavel: { nome: string } | null;
  confirmacoes: number;
  contestacoes: number;
  meuVoto: ValorVoto | null;
  estado: "NORMAL" | "CONTESTADO";
  podeEditar: boolean;
  podeApagar: boolean;
}

export interface EntradaPonto {
  tipo: TipoPonto;
  titulo: string;
  data: string;
  hora?: string;
  observacao?: string;
}
