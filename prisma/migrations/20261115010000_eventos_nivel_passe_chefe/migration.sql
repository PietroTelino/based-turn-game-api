-- Nível de conta: a experiência do jogador.
ALTER TABLE "users" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;

-- A experiência que cada batalha deu (nível e passe da temporada).
ALTER TABLE "battle_rewards" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;

-- Chefe semanal: a semana e o dano que o chefe levou na batalha.
ALTER TABLE "battles" ADD COLUMN "raid_week" TEXT;
ALTER TABLE "battles" ADD COLUMN "raid_damage" INTEGER;
CREATE INDEX "battles_raid_week_idx" ON "battles"("raid_week");
