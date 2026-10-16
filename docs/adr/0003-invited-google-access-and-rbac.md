# Use invited Google access with two ward roles

IPD Report uses Better Auth with Google sign-in, a seven-day invitation allowlist, and the same Google OAuth client as OKR Unit. Sessions last 14 days, while every protected request rechecks that the user is active and still has the required `nurse` or `ward_head` role; this keeps access changes immediate without requiring a separate identity system.

The first ward head is bootstrapped as `pongsakorn.wera@gmail.com`. Ward heads manage invitations, roles, and account status in Settings, and the system prevents demotion or deactivation of the last active ward head. Human routes require a session, while Better Auth endpoints, the signed LINE webhook, and the direct-database LINE worker keep their distinct machine boundaries.

Role-bearing changes are written to an immutable audit log. Existing mock census data is removed before rollout rather than attributed to a user.
