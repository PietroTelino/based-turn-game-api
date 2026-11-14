-- Temporadas ranqueadas: a temporada a que os pontos do jogador pertencem.
ALTER TABLE "users" ADD COLUMN "ranked_season" TEXT;

-- Torre: o andar da batalha.
ALTER TABLE "battles" ADD COLUMN "tower_floor" INTEGER;
CREATE INDEX "battles_user_id_tower_floor_idx" ON "battles"("user_id", "tower_floor");

-- Recompensas resgatadas uma vez só (missões, baús de estrelas, andares da torre).
CREATE TABLE "user_claims" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "diamonds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_claims_user_id_key_key" ON "user_claims"("user_id", "key");
ALTER TABLE "user_claims" ADD CONSTRAINT "user_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Como cada jogador terminou cada temporada.
CREATE TABLE "ranked_season_results" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "season" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "rank" TEXT NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "gold" INTEGER NOT NULL,
    "diamonds" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ranked_season_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ranked_season_results_user_id_season_key" ON "ranked_season_results"("user_id", "season");
ALTER TABLE "ranked_season_results" ADD CONSTRAINT "ranked_season_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Amizades e pedidos de amizade.
CREATE TABLE "friendships" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "addressee_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "friendships_requester_id_addressee_id_key" ON "friendships"("requester_id", "addressee_id");
CREATE INDEX "friendships_addressee_id_idx" ON "friendships"("addressee_id");
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Convites de amigos para a sala.
CREATE TABLE "room_invites" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "room_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "room_invites_room_id_to_id_key" ON "room_invites"("room_id", "to_id");
CREATE INDEX "room_invites_to_id_idx" ON "room_invites"("to_id");
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
