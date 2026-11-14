-- Login diário: o dia da sequência e o último dia resgatado.
ALTER TABLE "users" ADD COLUMN "login_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "login_last_day" TEXT;

-- Desafio diário: o dia do desafio da batalha.
ALTER TABLE "battles" ADD COLUMN "challenge_day" TEXT;
CREATE INDEX "battles_challenge_day_idx" ON "battles"("challenge_day");
