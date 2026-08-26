/**
 * Mirrors backend/src/curriculo/semestre.ts's proximoSemestre — só a função
 * que esta tela precisa no client, pra rotular o quadradinho pontilhado
 * extra do grid de arrasto antes de o servidor ter qualquer opinião sobre
 * ele.
 */
export function proximoSemestre(semestre: string): string {
  const [ano, periodo] = semestre.split(".").map(Number);
  return periodo === 1 ? `${ano}.2` : `${ano + 1}.1`;
}
