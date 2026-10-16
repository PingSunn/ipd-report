# Require complete user profiles before application access

Every authenticated user must provide a first name, last name, and nickname before using the census application. A profile is complete only when all three normalized fields are non-empty; this rule applies to existing accounts as well as newly invited users, so no separate one-time flag is needed.

Google remains the identity provider. The application may prefill first and last name from the Google display name, but the user confirms those values and supplies a nickname. Until the profile is complete, the authenticated application renders a non-dismissible modal over a blurred background. The user may sign out, but cannot reach application functions or dismiss the modal with Escape or an outside click.

Profile updates are made through a dedicated self-service authenticated endpoint. The server validates and normalizes all three fields, updates the canonical display name, and returns the refreshed session user. Authorization continues to use the immutable user ID, role, and active status rather than profile text.
