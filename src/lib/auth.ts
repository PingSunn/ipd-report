import { headers } from 'next/headers';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { prisma } from './prisma';
import { consumeInvitationForOAuth, findUsableInvitationForEmail, normalizeEmail } from './invitations';

const appUrl = process.env['BETTER_AUTH_URL'] ?? process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';
const configuredSecret = process.env['BETTER_AUTH_SECRET'];
if (process.env['NODE_ENV'] === 'production' && (!configuredSecret || configuredSecret.length < 32)) {
  throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 characters in production.');
}

const bootstrapEmail = normalizeEmail(
  process.env['AUTH_BOOTSTRAP_EMAIL'] ?? 'pongsakorn.wera@gmail.com',
);
const betterAuthSecret = configuredSecret ?? 'local-development-secret-change-before-production';
const trustedOrigins = (process.env['BETTER_AUTH_TRUSTED_ORIGINS'] ?? appUrl)
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const auth = betterAuth({
  appName: 'Inpatient Census Management',
  baseURL: appUrl,
  basePath: '/api/auth',
  secret: betterAuthSecret,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: false },
  socialProviders: {
    google: {
      clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      accessType: 'offline',
      prompt: 'select_account',
    },
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'nurse', input: false },
      active: { type: 'boolean', required: false, defaultValue: false, input: false },
      firstName: { type: 'string', required: false, input: false },
      lastName: { type: 'string', required: false, input: false },
      nickname: { type: 'string', required: false, input: false },
    },
    validateUserInfo: async ({ user, source }) => {
      const email = typeof user.email === 'string' ? normalizeEmail(user.email) : '';
      if (!email) {
        return { error: 'email_required', errorDescription: 'A verified Google email address is required.' };
      }

      if (source.method !== 'oauth' || source.oauth?.providerId !== 'google') {
        return { error: 'google_only', errorDescription: 'Google sign-in is required.' };
      }
      if (source.oauth.profile?.['email_verified'] !== true) {
        return { error: 'email_not_verified', errorDescription: 'Google must verify this email address.' };
      }

      const existing = await prisma.user.findUnique({ where: { email }, select: { active: true } });
      if (existing?.active) return;
      if (email === bootstrapEmail && !existing) return;
      if (await findUsableInvitationForEmail(email)) return;
      return { error: 'invitation_required', errorDescription: 'An invitation is required.' };
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, email: normalizeEmail(user.email) },
        }),
        after: async (user) => {
          const email = normalizeEmail(user.email);
          if (email === bootstrapEmail) {
            await prisma.user.update({
              where: { id: user.id },
              data: { role: 'ward_head', active: true, emailVerified: true },
            });
            await prisma.auditLog.create({
              data: {
                actorId: user.id,
                action: 'user.bootstrap.created',
                entityType: 'user',
                entityId: user.id,
                after: { role: 'ward_head', active: true },
              },
            });
            return;
          }
          await consumeInvitationForOAuth(email, user.id);
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { active: true, role: true },
          });
          return user?.active === true && (user.role === 'nurse' || user.role === 'ward_head');
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: appUrl.startsWith('https://'),
    disableCSRFCheck: false,
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 30,
  },
  plugins: [nextCookies()],
});

export async function authRequestHeaders(): Promise<Headers> {
  return await headers();
}
