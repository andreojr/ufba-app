/*
  Warnings:

  - You are about to drop the `cached_turma` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "cached_turma" DROP CONSTRAINT "cached_turma_schedule_user_id_fkey";

-- DropTable
DROP TABLE "cached_turma";

-- A turma associada a cada CachedSchedule acabou de ser apagada acima e não é
-- derivável retroativamente (falta "numero"). Um CachedSchedule órfão sem
-- turmas faria buscar() devolver `{ turmas: [] }` em vez de `null`, o que o
-- cliente lê como "sincronizado e matriculado em nada" em vez de "nunca
-- sincronizado" — uma sincronização falsa é pior do que nenhuma. Zera o cache
-- para que todo mundo caia em `unsynced` até o próximo sync real.
DELETE FROM "cached_schedule";

-- CreateTable
CREATE TABLE "turmas" (
    "id" TEXT NOT NULL,
    "semestre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "docente" TEXT,
    "vigencia_inicio" TEXT NOT NULL,
    "vigencia_fim" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriculas" (
    "user_id" TEXT NOT NULL,
    "turma_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "matriculas_pkey" PRIMARY KEY ("user_id","turma_id")
);

-- CreateTable
CREATE TABLE "pontos_atencao" (
    "id" TEXT NOT NULL,
    "turma_id" TEXT NOT NULL,
    "responsavel_id" TEXT,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "hora" TEXT,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pontos_atencao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pontos_atencao_voto" (
    "ponto_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pontos_atencao_voto_pkey" PRIMARY KEY ("ponto_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "turmas_semestre_codigo_numero_key" ON "turmas"("semestre", "codigo", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "matriculas_user_id_ordem_key" ON "matriculas"("user_id", "ordem");

-- CreateIndex
CREATE INDEX "pontos_atencao_turma_id_data_idx" ON "pontos_atencao"("turma_id", "data");

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_atencao" ADD CONSTRAINT "pontos_atencao_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_atencao" ADD CONSTRAINT "pontos_atencao_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_atencao_voto" ADD CONSTRAINT "pontos_atencao_voto_ponto_id_fkey" FOREIGN KEY ("ponto_id") REFERENCES "pontos_atencao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pontos_atencao_voto" ADD CONSTRAINT "pontos_atencao_voto_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
