-- Conta removida guarda o e-mail aqui; a coluna "email" recebe uma marca e fica livre para uma conta nova.
ALTER TABLE "users" ADD COLUMN "deleted_email" TEXT;

-- As contas que já estavam removidas liberam o e-mail agora.
UPDATE "users" SET "deleted_email" = "email", "email" = 'deleted:' || "id" WHERE "deleted_at" IS NOT NULL;
