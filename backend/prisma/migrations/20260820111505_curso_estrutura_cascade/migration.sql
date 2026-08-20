-- DropForeignKey
ALTER TABLE "estruturas_curriculares" DROP CONSTRAINT "estruturas_curriculares_curso_id_fkey";

-- AddForeignKey
ALTER TABLE "estruturas_curriculares" ADD CONSTRAINT "estruturas_curriculares_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cursos"("id_sigaa") ON DELETE CASCADE ON UPDATE CASCADE;
