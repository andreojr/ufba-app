-- CreateTable
CREATE TABLE "cursos" (
    "id_sigaa" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "sede" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cursos_pkey" PRIMARY KEY ("id_sigaa")
);

-- CreateTable
CREATE TABLE "estruturas_curriculares" (
    "id_sigaa" TEXT NOT NULL,
    "curso_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "ano_periodo_implementacao" TEXT NOT NULL,
    "carga_horaria_total" INTEGER NOT NULL,
    "carga_horaria_obrigatoria" INTEGER NOT NULL,
    "carga_horaria_optativa_minima" INTEGER NOT NULL,
    "carga_horaria_complementar_minima" INTEGER NOT NULL,
    "prazo_minimo_semestres" INTEGER NOT NULL,
    "prazo_medio_semestres" INTEGER NOT NULL,
    "prazo_maximo_semestres" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estruturas_curriculares_pkey" PRIMARY KEY ("id_sigaa")
);

-- CreateTable
CREATE TABLE "componentes_curriculares" (
    "id" TEXT NOT NULL,
    "estrutura_curricular_id" TEXT NOT NULL,
    "id_sigaa" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "carga_horaria" INTEGER NOT NULL,
    "natureza" TEXT NOT NULL,
    "periodo" INTEGER,
    "unidade_responsavel" TEXT,
    "pre_requisito" TEXT,
    "co_requisito" TEXT,
    "equivalencias" TEXT,

    CONSTRAINT "componentes_curriculares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estruturas_curriculares_curso_id_codigo_key" ON "estruturas_curriculares"("curso_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "componentes_curriculares_estrutura_curricular_id_codigo_key" ON "componentes_curriculares"("estrutura_curricular_id", "codigo");

-- AddForeignKey
ALTER TABLE "estruturas_curriculares" ADD CONSTRAINT "estruturas_curriculares_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cursos"("id_sigaa") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "componentes_curriculares" ADD CONSTRAINT "componentes_curriculares_estrutura_curricular_id_fkey" FOREIGN KEY ("estrutura_curricular_id") REFERENCES "estruturas_curriculares"("id_sigaa") ON DELETE CASCADE ON UPDATE CASCADE;
