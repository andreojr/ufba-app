-- AlterTable
-- Historico is replaced wholesale on every sync (see the model's own doc
-- comment), so the placeholder default only has to survive until the
-- existing row's next sync — it is never read as real data.
ALTER TABLE "historico" ADD COLUMN     "nome_curso" TEXT NOT NULL DEFAULT '';
ALTER TABLE "historico" ALTER COLUMN "nome_curso" DROP DEFAULT;
