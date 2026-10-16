'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { AuthMark, GoogleLoginButton, useAuth } from '../../components/auth/AuthProvider';

function LoginContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  useEffect(() => {
    if (!isLoading && user) router.replace(callbackUrl.startsWith('/') ? callbackUrl : '/');
  }, [callbackUrl, isLoading, router, user]);

  if (!isLoading && user) return null;

  return (
    <main className="min-h-screen bg-background px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-5xl items-center gap-10 lg:grid-cols-[1fr_420px]">
        <section className="hidden rounded-3xl border border-border bg-card p-10 text-foreground shadow-sm lg:block">
          <AuthMark />
          <p className="mt-10 text-sm font-semibold uppercase tracking-[0.18em] text-brand-cyan-strong">IPD Census</p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold leading-tight">ส่งต่อข้อมูลเวรอย่างมั่นใจ</h1>
          <p className="mt-5 max-w-md text-base leading-8 text-muted-foreground">
            บันทึกยอดผู้ป่วย เตรียมข้อความส่งต่อ และติดตามภาพรวมของหอผู้ป่วยในที่เดียว
          </p>
        </section>
        <section className="mx-auto w-full max-w-md rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-10">
          <div className="lg:hidden"><AuthMark /></div>
          <p className="mt-7 text-sm font-semibold text-brand-cyan-strong lg:mt-0">ระบบรายงานยอดผู้ป่วยใน</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">เข้าสู่ระบบ</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">ใช้บัญชี Google ที่ได้รับเชิญเข้าสู่ทีมของหอผู้ป่วย</p>
          <div className="mt-8"><GoogleLoginButton callbackUrl={callbackUrl.startsWith('/') ? callbackUrl : '/'} /></div>
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">ระบบรองรับการเข้าสู่ระบบด้วย Google เท่านั้น</p>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-background">กำลังโหลด…</main>}><LoginContent /></Suspense>;
}
