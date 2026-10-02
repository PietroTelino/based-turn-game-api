-- AlterTable
ALTER TABLE "battles" ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 0;

-- Batalhas gravadas antes dos turnos por rodada: lá, "turn" contava cada vez
-- jogada. Esse número passa para "step" (que agora faz esse papel), e "turn"
-- vira o turno aproximado: vezes jogadas divididas pelo número de unidades.
UPDATE "battles"
SET "step" = "turn",
    "turn" = GREATEST(1, CEIL("turn"::numeric / GREATEST(1, jsonb_array_length("state" -> 'units')))::integer);
