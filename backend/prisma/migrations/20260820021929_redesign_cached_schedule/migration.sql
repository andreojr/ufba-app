/*
  Warnings:

  - The primary key for the `cached_schedule` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `data` on the `cached_schedule` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `cached_schedule` table. All the data in the column will be lost.
  - You are about to drop the column `semestre` on the `cached_schedule` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "cached_schedule_user_id_idx";

-- AlterTable
ALTER TABLE "cached_schedule" DROP CONSTRAINT "cached_schedule_pkey",
DROP COLUMN "data",
DROP COLUMN "id",
DROP COLUMN "semestre",
ADD COLUMN     "periodo_letivo_fim" TEXT,
ADD COLUMN     "periodo_letivo_inicio" TEXT,
ADD COLUMN     "periodo_letivo_semestre" TEXT,
ADD CONSTRAINT "cached_schedule_pkey" PRIMARY KEY ("user_id");

-- CreateTable
CREATE TABLE "cached_turma" (
    "id" TEXT NOT NULL,
    "schedule_user_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo" TEXT,
    "nome" TEXT NOT NULL,
    "docente" TEXT,
    "semestre" TEXT NOT NULL,
    "vigencia_inicio" TEXT NOT NULL,
    "vigencia_fim" TEXT NOT NULL,
    "slots" JSONB NOT NULL,

    CONSTRAINT "cached_turma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cached_turma_schedule_user_id_ordem_key" ON "cached_turma"("schedule_user_id", "ordem");

-- AddForeignKey
ALTER TABLE "cached_turma" ADD CONSTRAINT "cached_turma_schedule_user_id_fkey" FOREIGN KEY ("schedule_user_id") REFERENCES "cached_schedule"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
