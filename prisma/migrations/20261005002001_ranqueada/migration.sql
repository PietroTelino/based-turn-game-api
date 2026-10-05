-- AlterTable
ALTER TABLE "battles" ADD COLUMN     "has_replay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "initial_state" JSONB,
ADD COLUMN     "ranked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rating_delta_a" INTEGER,
ADD COLUMN     "rating_delta_b" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ranked_losses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ranked_wins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "battle_picks" (
    "id" UUID NOT NULL,
    "battle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "character_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranked_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "team" JSONB NOT NULL,
    "rating" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'searching',
    "battle_id" UUID,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "battle_picks_user_id_character_id_idx" ON "battle_picks"("user_id", "character_id");

-- CreateIndex
CREATE INDEX "battle_picks_character_id_idx" ON "battle_picks"("character_id");

-- CreateIndex
CREATE INDEX "battle_picks_battle_id_idx" ON "battle_picks"("battle_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranked_tickets_user_id_key" ON "ranked_tickets"("user_id");

-- CreateIndex
CREATE INDEX "ranked_tickets_status_queued_at_idx" ON "ranked_tickets"("status", "queued_at");

-- AddForeignKey
ALTER TABLE "battle_picks" ADD CONSTRAINT "battle_picks_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_picks" ADD CONSTRAINT "battle_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranked_tickets" ADD CONSTRAINT "ranked_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
