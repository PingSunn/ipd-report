-- Older installs seeded a known bootstrap identity directly in schema history.
-- Preserve a real linked account, but remove the unclaimed placeholder so a
-- fresh install can bootstrap only through explicit AUTH_BOOTSTRAP_EMAIL OAuth.
DELETE FROM "User"
WHERE "id" = 'bootstrap-pongsakorn-ward-head'
  AND "email" = 'pongsakorn.wera@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM "Account" WHERE "Account"."userId" = "User"."id"
  );
