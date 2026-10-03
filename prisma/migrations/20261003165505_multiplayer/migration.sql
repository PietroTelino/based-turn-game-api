-- AlterTable
ALTER TABLE "battles" ADD COLUMN     "events" JSONB,
ADD COLUMN     "opponent_id" UUID;

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "host_id" UUID NOT NULL,
    "guest_id" UUID,
    "host_team" JSONB,
    "guest_team" JSONB,
    "host_ready" BOOLEAN NOT NULL DEFAULT false,
    "guest_ready" BOOLEAN NOT NULL DEFAULT false,
    "battle_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");

-- CreateIndex
CREATE INDEX "rooms_status_created_at_idx" ON "rooms"("status", "created_at");

-- CreateIndex
CREATE INDEX "battles_opponent_id_created_at_idx" ON "battles"("opponent_id", "created_at");

-- AddForeignKey
ALTER TABLE "battles" ADD CONSTRAINT "battles_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
