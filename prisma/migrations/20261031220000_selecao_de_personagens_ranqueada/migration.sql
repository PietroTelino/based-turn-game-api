-- AlterTable
ALTER TABLE "ranked_tickets" ADD COLUMN "draft_id" UUID;

-- CreateTable
CREATE TABLE "ranked_drafts" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "battle_id" UUID,
    "turn_started_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranked_drafts_pkey" PRIMARY KEY ("id")
);
