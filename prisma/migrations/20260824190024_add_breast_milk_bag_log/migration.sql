-- CreateTable
CREATE TABLE "BreastMilkBagLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "time" DATETIME NOT NULL,
    "bagCount" INTEGER NOT NULL,
    "amountPerBag" REAL NOT NULL,
    "unitAbbr" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "familyId" TEXT,
    "babyId" TEXT NOT NULL,
    "caretakerId" TEXT,
    CONSTRAINT "BreastMilkBagLog_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BreastMilkBagLog_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BreastMilkBagLog_caretakerId_fkey" FOREIGN KEY ("caretakerId") REFERENCES "Caretaker" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BreastMilkBagLog_time_idx" ON "BreastMilkBagLog"("time");

-- CreateIndex
CREATE INDEX "BreastMilkBagLog_babyId_idx" ON "BreastMilkBagLog"("babyId");

-- CreateIndex
CREATE INDEX "BreastMilkBagLog_caretakerId_idx" ON "BreastMilkBagLog"("caretakerId");

-- CreateIndex
CREATE INDEX "BreastMilkBagLog_deletedAt_idx" ON "BreastMilkBagLog"("deletedAt");

-- CreateIndex
CREATE INDEX "BreastMilkBagLog_familyId_idx" ON "BreastMilkBagLog"("familyId");

