-- AlterTable
ALTER TABLE "battles" ADD COLUMN     "campaign_stage" INTEGER,
ADD COLUMN     "difficulty" TEXT;

-- CreateIndex
CREATE INDEX "battles_user_id_campaign_stage_idx" ON "battles"("user_id", "campaign_stage");
