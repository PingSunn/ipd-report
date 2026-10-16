-- Store the profile fields required by the first-login completion flow.
ALTER TABLE "User"
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "nickname" TEXT;
