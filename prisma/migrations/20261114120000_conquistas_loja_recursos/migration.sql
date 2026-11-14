-- Recursos do jogador: ouro (ganho jogando) e diamantes (o recurso pago).
ALTER TABLE "users" ADD COLUMN "gold" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "diamonds" INTEGER NOT NULL DEFAULT 0;

-- Personagens desbloqueados (os iniciais valem para todos e não têm linha).
CREATE TABLE "user_characters" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "character_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_characters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_characters_user_id_character_id_key" ON "user_characters"("user_id", "character_id");
ALTER TABLE "user_characters" ADD CONSTRAINT "user_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conquistas completadas.
CREATE TABLE "user_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "achievement_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_achievements_user_id_achievement_id_key" ON "user_achievements"("user_id", "achievement_id");
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O que cada jogador ganhou ao fim de cada batalha.
CREATE TABLE "battle_rewards" (
    "id" UUID NOT NULL,
    "battle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "gold" INTEGER NOT NULL,
    "achievements" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "battle_rewards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "battle_rewards_battle_id_user_id_key" ON "battle_rewards"("battle_id", "user_id");
ALTER TABLE "battle_rewards" ADD CONSTRAINT "battle_rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
