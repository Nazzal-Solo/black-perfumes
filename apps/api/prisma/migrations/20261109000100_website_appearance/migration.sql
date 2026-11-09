CREATE TABLE "WebsiteAppearance" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "draft" JSONB NOT NULL,
  "published" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "publishedRevision" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebsiteAppearance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebsiteAppearance_singleton" CHECK ("id" = 1)
);
CREATE TABLE "AppearanceAsset" (
  "id" UUID NOT NULL,
  "slot" VARCHAR(16) NOT NULL,
  "cloudinaryPublicId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "deleting" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppearanceAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AppearanceAsset_slot" CHECK ("slot" IN ('logo','favicon','hero','men','women','unisex'))
);
CREATE UNIQUE INDEX "AppearanceAsset_cloudinaryPublicId_key" ON "AppearanceAsset"("cloudinaryPublicId");
INSERT INTO "WebsiteAppearance" ("id", "draft", "published") VALUES (
  1,
  '{"themePreset":"emerald-lab","assets":{"logo":null,"favicon":null,"hero":null,"men":null,"women":null,"unisex":null}}',
  '{"themePreset":"emerald-lab","assets":{"logo":null,"favicon":null,"hero":null,"men":null,"women":null,"unisex":null}}'
);
