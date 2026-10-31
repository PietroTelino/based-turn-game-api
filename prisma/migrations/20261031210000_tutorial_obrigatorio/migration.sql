-- Quando o jogador terminou a batalha de treino (o tutorial). Vazio = tutorial ainda obrigatório.
ALTER TABLE "users" ADD COLUMN "tutorial_completed_at" TIMESTAMP(3);

-- Quem já terminou uma batalha de treino sem desistir não precisa fazer o tutorial de novo.
UPDATE "users" AS u
SET "tutorial_completed_at" = done."finished_at"
FROM (
    SELECT "user_id", MIN(COALESCE("finished_at", "updated_at")) AS "finished_at"
    FROM "battles"
    WHERE "status" = 'finished'
      AND ("state"->>'training') = 'true'
      AND ("state"->>'surrenderedBy') IS NULL
    GROUP BY "user_id"
) AS done
WHERE u."id" = done."user_id";
