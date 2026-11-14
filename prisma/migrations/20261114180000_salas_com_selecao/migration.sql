-- A seleção das salas usa a mesma tabela da ranqueada, marcada como casual.
ALTER TABLE "ranked_drafts" ADD COLUMN "ranked" BOOLEAN NOT NULL DEFAULT true;

-- A sala guarda a seleção de personagens dos dois jogadores.
ALTER TABLE "rooms" ADD COLUMN "draft_id" UUID;
