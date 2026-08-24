-- Restore this fork's Settings columns after upstream's table rebuild.
--
-- SQLite cannot ALTER COLUMN, so Prisma implements schema changes to Settings
-- as a full table rebuild (CREATE new_Settings / INSERT SELECT / DROP / RENAME).
-- Upstream authors those rebuilds against upstream's column list, which does not
-- include this fork's additions. Upstream's 20260719232539_add_who_growth_chart_data
-- sorts before our July migrations by name, but on an existing deployment ours were
-- applied months earlier and theirs is still pending — so it runs last and silently
-- drops all three fork columns. The generated Prisma client still expects them, so
-- every Settings read or write then fails with P2022 and the app cannot boot.
--
-- This migration is named to sort after every upstream migration through 1.6.5 so it
-- always runs afterwards and puts the columns back. Plain ADD COLUMN is used rather
-- than another table rebuild: it is valid on both SQLite and PostgreSQL (this project
-- supports both), it copies no rows, and it touches no foreign keys.
--
-- Column VALUES are not recoverable here — upstream's rebuild discards them before
-- this runs. Capture them before deploying and write them back afterwards; see
-- documentation/upstream-sync.md.
ALTER TABLE "Settings" ADD COLUMN "pottyLocationSettings" TEXT;
ALTER TABLE "Settings" ADD COLUMN "hueConfig" TEXT;
ALTER TABLE "Settings" ADD COLUMN "dailyStatsAvgDays" INTEGER NOT NULL DEFAULT 5;
