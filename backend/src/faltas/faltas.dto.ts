import { IsInt, Max, Min } from 'class-validator';

export class DefinirFaltasDto {
  /**
   * O contador é absoluto (o cliente manda o total, não um delta) — assim
   * reenviar a mesma requisição é idempotente, e dois aparelhos do mesmo aluno
   * convergem no último valor salvo em vez de somarem duas vezes.
   *
   * O teto de 999 não é regra acadêmica: é só o limite do que cabe no badge e
   * uma barreira contra número absurdo vindo de cliente adulterado.
   */
  @IsInt()
  @Min(0)
  @Max(999)
  faltas!: number;
}
