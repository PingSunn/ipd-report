'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertCircle, ChevronDown, Hospital, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  getSession,
  signInWithGoogle,
  signOut as signOutRequest,
  updateCurrentProfile,
  type AuthSession,
  type AuthUser,
} from '../../services/authService';
import { ProfileCompletionDialog } from './ProfileCompletionDialog';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signIn: (callbackUrl?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setSession(await getSession());
      setError(null);
    } catch (cause: unknown) {
      setSession(null);
      setError(cause instanceof Error ? cause.message : 'ไม่สามารถตรวจสอบ session ได้');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await signOutRequest();
    setSession(null);
    window.location.assign('/login');
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    isLoading,
    error,
    refresh,
    signIn: async (callbackUrl = window.location.pathname) => {
      setError(null);
      await signInWithGoogle(callbackUrl);
    },
    signOut,
  }), [error, isLoading, refresh, session, signOut]);

  const user = session?.user ?? null;
  return (
    <AuthContext.Provider value={value}>
      {children}
      {user && user.status === 'ACTIVE' && !user.profileComplete && (
        <ProfileCompletionDialog
          initialProfile={{
            firstName: user.firstName ?? user.suggestedFirstName ?? '',
            lastName: user.lastName ?? user.suggestedLastName ?? '',
            nickname: user.nickname ?? '',
          }}
          onSave={async (profile) => {
            await updateCurrentProfile(profile);
            const refreshed = await getSession();
            if (!refreshed?.user.profileComplete) throw new Error('บันทึกแล้วแต่ยังโหลดโปรไฟล์ล่าสุดไม่ได้ กรุณาลองใหม่');
            setSession(refreshed);
          }}
          onSignOut={signOut}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <RefreshCw className="size-5 animate-spin text-primary" aria-hidden="true" />
        กำลังตรวจสอบการเข้าสู่ระบบ…
      </div>
    </main>
  );
}

function SessionError({ onRetry, message }: { onRetry: () => void; message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <Alert variant="destructive" className="max-w-lg border-destructive/25 bg-surface-danger text-destructive-strong">
        <AlertCircle />
        <AlertTitle>ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{message}</span>
          <Button type="button" variant="outline" className="border-destructive/30 bg-card text-destructive" onClick={onRetry}>
            <RefreshCw /> ลองใหม่
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  );
}

function SuspendedScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6">
      <Alert variant="destructive" className="max-w-lg border-destructive/25 bg-surface-danger text-destructive-strong">
        <AlertCircle />
        <AlertTitle>บัญชีถูกระงับ</AlertTitle>
        <AlertDescription>บัญชีนี้ยังไม่สามารถใช้งานระบบได้ กรุณาติดต่อหัวหน้าหอผู้ป่วย</AlertDescription>
      </Alert>
    </main>
  );
}

function ProfilePendingScreen() {
  return (
    <main className="min-h-screen bg-background" aria-hidden="true">
      <div className="h-16 border-b border-border bg-card" />
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div className="h-8 w-52 rounded-md bg-muted" />
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="h-32 rounded-xl border border-border bg-card" />
          <div className="h-32 rounded-xl border border-border bg-card" />
          <div className="h-32 rounded-xl border border-border bg-card" />
        </div>
        <div className="h-72 rounded-xl border border-border bg-card" />
      </div>
    </main>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const auth = useAuth();
  const isLogin = pathname === '/login';

  useEffect(() => {
    if (!auth.isLoading && !auth.error && !isLogin && !auth.user) {
      const callback = `${pathname}${window.location.search}`;
      router.replace(`/login?callbackUrl=${encodeURIComponent(callback)}`);
    }
  }, [auth.error, auth.isLoading, auth.user, isLogin, pathname, router]);

  if (isLogin) return <>{children}</>;
  if (auth.isLoading) return <LoadingScreen />;
  if (auth.error) return <SessionError onRetry={() => void auth.refresh()} message={auth.error} />;
  if (!auth.user) return <LoadingScreen />;
  if (auth.user.status === 'SUSPENDED') return <SuspendedScreen />;
  if (!auth.user.profileComplete) return <ProfilePendingScreen />;
  return <>{children}</>;
}

export function AccountControl() {
  const { user, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  if (!user) return null;
  const label = user.role === 'WARD_HEAD' ? 'หัวหน้าหอผู้ป่วย' : 'พยาบาล';
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 max-w-40 items-center gap-2 rounded-lg px-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:max-w-52"
          aria-label={`เมนูบัญชี ${fullName}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-primary" aria-hidden="true">{fullName.trim().charAt(0).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground sm:text-sm">{fullName}</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">{label}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate font-semibold text-foreground">{fullName}</span>
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{label}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="min-h-10"
          disabled={isSigningOut}
          onSelect={() => {
            setIsSigningOut(true);
            void signOut().catch(() => setIsSigningOut(false));
          }}
        >
          <LogOut />{isSigningOut ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GoogleLoginButton({ callbackUrl }: { callbackUrl: string }) {
  const { signIn } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        type="button"
        size="lg"
        className="w-full bg-primary text-primary-foreground hover:bg-primary/85"
        disabled={isSigningIn}
        onClick={() => {
          setIsSigningIn(true);
          setError(null);
          void signIn(callbackUrl).catch((cause: unknown) => {
            setIsSigningIn(false);
            setError(cause instanceof Error ? cause.message : 'เข้าสู่ระบบไม่สำเร็จ');
          });
        }}
      >
        <LogIn />
        {isSigningIn ? 'กำลังเชื่อมต่อ Google…' : 'เข้าสู่ระบบด้วย Google'}
      </Button>
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

export function AuthMark() {
  return (
    <div className="grid size-12 place-items-center rounded-2xl bg-brand-cyan text-brand-navy-strong shadow-sm">
      <Hospital className="size-6" aria-hidden="true" />
    </div>
  );
}
