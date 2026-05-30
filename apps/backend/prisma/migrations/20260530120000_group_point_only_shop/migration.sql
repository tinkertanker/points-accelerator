ALTER TABLE "ShopItem" ALTER COLUMN "audience" SET DEFAULT 'GROUP';

UPDATE "ShopItem"
SET "audience" = 'GROUP';
