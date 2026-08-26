import { postDocentesSemestre, postScheduleSync, postTrajetoriaSync } from "@/lib/api";
import type { DocenteResumo, ScheduleResponse, SigaaCredentials, TrajetoriaResponse } from "@/lib/types";

/**
 * Horário e histórico re-scrapam documentos diferentes do SIGAA e não
 * dependem um do outro — daí `Promise.allSettled`: um pode falhar sem
 * derrubar o outro. Isso já era o que `ajustes.tsx` fazia sozinho; agora é
 * a peça reaproveitada por todo ponto que precisa dos dois de uma vez (ver
 * `syncAll` abaixo, e cada tela que chama esta função no lugar de só reler
 * o cache local em seu "tentar de novo").
 */
export interface SyncTudoResult {
  horario: PromiseSettledResult<ScheduleResponse>;
  historico: PromiseSettledResult<TrajetoriaResponse>;
}

export async function syncTudo(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<SyncTudoResult> {
  const [horario, historico] = await Promise.allSettled([
    postScheduleSync(accessToken, credentials),
    postTrajetoriaSync(accessToken, credentials),
  ]);
  return { horario, historico };
}

/**
 * O terceiro passo, de propósito fora do `Promise.allSettled` acima:
 * docentes não é um documento independente do SIGAA como horário e
 * histórico são entre si — ele precisa das turmas que só existem depois que
 * o horário sincronizou. Por isso roda encadeado, nunca em paralelo com ele.
 * `docentes` fica `null` quando não há turmas com docente para resolver
 * (horário falhou, ou a turma não tinha docente no atestado) — nesse caso
 * não há nada de errado, só nada a fazer.
 */
export interface SyncAllResult extends SyncTudoResult {
  docentes: PromiseSettledResult<DocenteResumo[]> | null;
}

export async function syncAll(
  accessToken: string,
  credentials: Pick<SigaaCredentials, "login" | "senha">,
): Promise<SyncAllResult> {
  const tudo = await syncTudo(accessToken, credentials);

  const turmas = tudo.horario.status === "fulfilled" && "turmas" in tudo.horario.value ? tudo.horario.value.turmas : null;
  const comDocente = turmas?.filter((t) => Boolean(t.docente)) ?? [];
  if (comDocente.length === 0) {
    return { ...tudo, docentes: null };
  }

  const turmasComDocente = comDocente.map((t) => ({
    codigo: t.codigo ?? "",
    nome: t.nome,
    docente: t.docente as string,
  }));
  try {
    const docentes = await postDocentesSemestre(accessToken, turmasComDocente);
    return { ...tudo, docentes: { status: "fulfilled", value: docentes } };
  } catch (reason) {
    return { ...tudo, docentes: { status: "rejected", reason } };
  }
}
