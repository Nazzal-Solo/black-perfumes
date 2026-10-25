CREATE TYPE "ProductType" AS ENUM ('UNCONFIRMED', 'INSPIRED', 'ORIGINAL', 'OTHER');
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');
ALTER TABLE "Product" ALTER COLUMN "priceJod" DROP NOT NULL,
 ADD COLUMN "inspirationBrand" VARCHAR(200), ADD COLUMN "inspirationFragrance" VARCHAR(200),
 ADD COLUMN "productType" "ProductType" NOT NULL DEFAULT 'UNCONFIRMED',
 ADD COLUMN "customDisplayName" VARCHAR(200), ADD COLUMN "nameAr" VARCHAR(200),
 ADD COLUMN "descriptionAr" TEXT, ADD COLUMN "disclosureText" TEXT, ADD COLUMN "disclosureAr" TEXT,
 ADD COLUMN "availability" "Availability", ADD COLUMN "sizeMl" DECIMAL(8,2),
 ADD COLUMN "concentration" VARCHAR(120), ADD COLUMN "fragranceNotes" TEXT, ADD COLUMN "fragranceNotesAr" TEXT,
 ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "catalogImportKey" TEXT,
 ADD COLUMN "catalogReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "seasonalRecommendations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "reviewNotes" TEXT;
CREATE UNIQUE INDEX "Product_catalogImportKey_key" ON "Product"("catalogImportKey");
