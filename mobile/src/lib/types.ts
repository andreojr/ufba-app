export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
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

/** One weekly occurrence of a turma — see backend TurmaSlot. */
export interface TurmaSlot {
  dia: string;
  inicioMin: number;
  fimMin: number;
  predio: string | null;
  sala: string | null;
  localOriginal: string;
}

/** A course the student is currently enrolled in, as scraped from the SIGAA portal home. */
export interface Turma {
  codigo: string | null;
  nome: string;
  slots: TurmaSlot[];
  vigencia: { inicio: string; fim: string };
  semestre: string;
}
