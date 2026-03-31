-- AlterTable: Add structured specification fields to Item
ALTER TABLE "Item" ADD COLUMN "objective" TEXT;
ALTER TABLE "Item" ADD COLUMN "acceptance" TEXT;
ALTER TABLE "Item" ADD COLUMN "context" TEXT;
