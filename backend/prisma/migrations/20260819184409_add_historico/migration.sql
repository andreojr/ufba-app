-- CreateTable
CREATE TABLE "historico" (
    "user_id" TEXT NOT NULL,
    "emitido_em" TIMESTAMP(3) NOT NULL,
    "curriculo" TEXT NOT NULL,
    "periodo_letivo_atual" INTEGER NOT NULL,
    "prazo_padrao" TEXT NOT NULL,
    "prazo_maximo" TEXT NOT NULL,
    "cr" DECIMAL(6,4),
    "iap" DECIMAL(6,4),
    "ch_obrigatoria_exigida" INTEGER NOT NULL,
    "ch_obrigatoria_integralizada" INTEGER NOT NULL,
    "ch_obrigatoria_pendente" INTEGER NOT NULL,
    "ch_optativa_exigida" INTEGER NOT NULL,
    "ch_optativa_integralizada" INTEGER NOT NULL,
    "ch_optativa_pendente" INTEGER NOT NULL,
    "ch_complementar_exigida" INTEGER NOT NULL,
    "ch_complementar_integralizada" INTEGER NOT NULL,
    "ch_complementar_pendente" INTEGER NOT NULL,
    "ch_total_exigida" INTEGER NOT NULL,
    "ch_total_integralizada" INTEGER NOT NULL,
    "ch_total_pendente" INTEGER NOT NULL,
    "equivalencias" TEXT[],
    "observacoes" TEXT[],
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "historico_componente" (
    "id" TEXT NOT NULL,
    "historico_id" TEXT NOT NULL,
    "semestre" TEXT NOT NULL,
    "natureza" TEXT,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "carga_horaria" INTEGER NOT NULL,
    "nota" DECIMAL(3,1),
    "situacao" TEXT NOT NULL,
    "docente" TEXT,

    CONSTRAINT "historico_componente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_pendente" (
    "id" TEXT NOT NULL,
    "historico_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "carga_horaria" INTEGER NOT NULL,
    "matriculado" BOOLEAN NOT NULL,

    CONSTRAINT "historico_pendente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_item" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "carga_horaria" INTEGER NOT NULL,
    "semestre" TEXT,

    CONSTRAINT "plano_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historico_componente_historico_id_semestre_idx" ON "historico_componente"("historico_id", "semestre");

-- CreateIndex
CREATE UNIQUE INDEX "historico_componente_historico_id_semestre_codigo_key" ON "historico_componente"("historico_id", "semestre", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "historico_pendente_historico_id_codigo_nome_key" ON "historico_pendente"("historico_id", "codigo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "plano_item_user_id_codigo_key" ON "plano_item"("user_id", "codigo");

-- AddForeignKey
ALTER TABLE "historico" ADD CONSTRAINT "historico_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_componente" ADD CONSTRAINT "historico_componente_historico_id_fkey" FOREIGN KEY ("historico_id") REFERENCES "historico"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_pendente" ADD CONSTRAINT "historico_pendente_historico_id_fkey" FOREIGN KEY ("historico_id") REFERENCES "historico"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_item" ADD CONSTRAINT "plano_item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
