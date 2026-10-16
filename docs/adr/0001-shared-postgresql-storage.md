# Use shared PostgreSQL storage

The rebuild replaces the existing JSON-file persistence with PostgreSQL hosted on Supabase, as requested by the product owner. Local development uses a dedicated Docker PostgreSQL instance so development does not depend on or modify the hosted database. Google Apps Script compatibility is removed; the existing census and reporting capabilities remain in scope.
