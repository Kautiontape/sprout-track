-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "pottyLocationSettings" TEXT;

-- CreateTable
CREATE TABLE "PottyLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "time" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "pottyLocation" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "familyId" TEXT,
    "babyId" TEXT NOT NULL,
    "caretakerId" TEXT,
    CONSTRAINT "PottyLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PottyLog_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PottyLog_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "Caretaker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PottyLog_time_idx" ON "PottyLog"("time");

-- CreateIndex
CREATE INDEX "PottyLog_babyId_idx" ON "PottyLog"("babyId");

-- CreateIndex
CREATE INDEX "PottyLog_caretakerId_idx" ON "PottyLog"("caretakerId");

-- CreateIndex
CREATE INDEX "PottyLog_deletedAt_idx" ON "PottyLog"("deletedAt");

-- CreateIndex
CREATE INDEX "PottyLog_familyId_idx" ON "PottyLog"("familyId");
