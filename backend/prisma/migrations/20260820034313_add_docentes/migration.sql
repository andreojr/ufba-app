-- CreateTable
CREATE TABLE "docentes" (
    "siape" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "departamento" TEXT,
    "unidade" TEXT,
    "descricao_pessoal" TEXT,
    "formacao" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areas_interesse" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lattes_url" TEXT,
    "endereco_profissional" TEXT,
    "sala" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "disciplinas" JSONB NOT NULL DEFAULT '[]',
    "tccs_orientados" JSONB NOT NULL DEFAULT '[]',
    "orientacoes_mestrado_andamento" INTEGER NOT NULL DEFAULT 0,
    "orientacoes_mestrado_concluidas" INTEGER NOT NULL DEFAULT 0,
    "orientacoes_doutorado_andamento" INTEGER NOT NULL DEFAULT 0,
    "orientacoes_doutorado_concluidas" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docentes_pkey" PRIMARY KEY ("siape")
);

-- CreateTable
CREATE TABLE "docente_lookup" (
    "nome_normalizado" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "siape" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docente_lookup_pkey" PRIMARY KEY ("nome_normalizado")
);
