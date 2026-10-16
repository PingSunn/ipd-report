"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  BarChart3,
  ClipboardList,
  Database,
  FileText,
  Hospital,
  History,
  MessageSquareText,
  Plus,
  Settings,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./components/ui/empty";
import { Skeleton } from "./components/ui/skeleton";
import { CensusAnalytics } from "./components/CensusAnalytics";
import { CensusForm } from "./components/CensusFormModal";
import { CensusRecordsTable } from "./components/CensusRecordsTable";
import { LatestShiftOverview } from "./components/LatestShiftOverview";
import { LineReportGenerator } from "./components/LineReportGenerator";
import { SettingsPanel } from "./components/SettingsPanel";
import { AccountControl, useAuth } from "./components/auth/AuthProvider";
import type { UserRole } from "./services/authService";
import {
  deleteCensusRecord,
  getCensusRecords,
  saveCensusRecord,
} from "./services/censusService";
import { getSettings, type SettingsSnapshot } from "./services/settingsService";
import { CensusRecord, SHIFT_META } from "./types/census";
import {
  formatThaiDate,
  formatUpdatedAt,
  getTodayDateString,
} from "./utils/censusUtils";
import type { SharedReportSettings } from "./utils/censusUtils";

type ActiveTab = "overview" | "entry" | "line" | "history" | "analytics" | "settings";
type Notice = { type: "success" | "error"; message: string };
const navItems: Array<{
  id: ActiveTab;
  label: string;
  href: string;
  icon: React.ElementType;
  wardHeadOnly?: boolean;
}> = [
  { id: "overview", label: "ภาพรวม", href: "/", icon: Activity },
  { id: "entry", label: "บันทึกยอดเวร", href: "/entry", icon: ClipboardList },
  { id: "line", label: "ส่ง LINE", href: "/line", icon: MessageSquareText },
  { id: "history", label: "ประวัติ", href: "/history", icon: History },
  { id: "analytics", label: "วิเคราะห์", href: "/analytics", icon: BarChart3, wardHeadOnly: true },
];

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "เกิดข้อผิดพลาดในการโหลดข้อมูล";
}
function routeToTab(pathname: string): ActiveTab {
  if (pathname === "/entry") return "entry";
  if (pathname === "/line") return "line";
  if (pathname === "/history") return "history";
  if (pathname === "/analytics") return "analytics";
  if (pathname === "/settings") return "settings";
  return "overview";
}

export default function App() {
  const { user } = useAuth();
  const role: UserRole = user?.role ?? "NURSE";
  const isWardHead = role === "WARD_HEAD";
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = routeToTab(pathname || "/");
  const visibleNavItems = navItems.filter((item) => !item.wardHeadOnly || isWardHead);
  const mobileNavItems: typeof navItems = isWardHead
    ? [...visibleNavItems, { id: "settings", label: "ตั้งค่า", href: "/settings", icon: Settings }]
    : visibleNavItems;
  const requestedRecordId = searchParams.get("id");
  const [records, setRecords] = useState<CensusRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<CensusRecord | null>(
    null,
  );
  const [editingRecord, setEditingRecord] = useState<CensusRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState<SettingsSnapshot | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);

  const showNotice = useCallback(
    (message: string, type: Notice["type"] = "success") => {
      setNotice({ message, type });
      window.setTimeout(
        () =>
          setNotice((current) =>
            current?.message === message ? null : current,
          ),
        3800,
      );
    },
    [],
  );

  const loadRecords = useCallback(
    async (silent = false) => {
      if (silent) setIsSyncing(true);
      else setIsLoading(true);
      try {
        const result = await getCensusRecords();
        setLoadError(null);
        setRecords(result.records);
        setLastSyncedAt(result.syncedAt);
        setSelectedRecord((current) => {
          if (!current) return result.records[0] || null;
          return (
            result.records.find((record) => record.id === current.id) ||
            result.records[0] ||
            null
          );
        });
      } catch (error: unknown) {
        if (!silent) {
          const message = getErrorMessage(error);
          setLoadError(message);
          showNotice(message, "error");
        }
      } finally {
        setIsLoading(false);
        setIsSyncing(false);
      }
    },
    [showNotice],
  );

  const loadSettings = useCallback(async (silent = false) => {
    if (!silent) setIsSettingsLoading(true);
    try {
      const snapshot = await getSettings();
      setSettingsSnapshot(snapshot);
      setSettingsError(null);
    } catch (error: unknown) {
      if (!silent) setSettingsError(getErrorMessage(error));
    } finally {
      if (!silent) setIsSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isWardHead && (activeTab === "analytics" || activeTab === "settings")) {
      router.replace("/");
    }
  }, [activeTab, isWardHead, router]);

  useEffect(() => {
    setTodayDate(getTodayDateString());
    void loadRecords();
    void loadSettings();
    const intervalId = window.setInterval(() => {
      void loadRecords(true);
      void loadSettings(true);
    }, 10000);
    const syncOnFocus = () => {
      if (document.visibilityState === "visible") {
        void loadRecords(true);
        void loadSettings(true);
      }
    };
    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnFocus);
    };
  }, [loadRecords, loadSettings]);

  useEffect(() => {
    if (!requestedRecordId || !records.length) return;
    const requested = records.find((record) => record.id === requestedRecordId);
    if (!requested) return;
    setSelectedRecord(requested);
    if (activeTab === "entry") setEditingRecord(requested);
  }, [activeTab, records, requestedRecordId]);

  const activeLineRecord = selectedRecord || records[0] || null;
  const reportSettings: SharedReportSettings | undefined = settingsSnapshot
    ? {
        hospitalName: settingsSnapshot.settings.hospitalName,
        wardName: settingsSnapshot.settings.wardName,
        reportFormat: settingsSnapshot.settings.reportFormat,
        includeCapacityAndOccupancy: settingsSnapshot.settings.includeCapacityAndOccupancy,
        includeCategories: settingsSnapshot.settings.includeCategories,
        includeWorkloadHours: settingsSnapshot.settings.includeWorkloadHours,
        includeNote: settingsSnapshot.settings.includeNote,
      }
    : undefined;
  const handleSaveRecord = async (record: CensusRecord) => {
    setIsSubmitting(true);
    try {
      const response = await saveCensusRecord(record);
      if (!response.success) {
        showNotice(
          response.error || "ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง",
          "error",
        );
        return;
      }
      const saved = response.record || record;
      await loadRecords(true);
      setSelectedRecord(saved);
      setEditingRecord(null);
      router.push("/");
      showNotice(
        `${response.message || "บันทึกสำเร็จ"} · ${formatThaiDate(saved.date)} ${SHIFT_META[saved.shift].label}`,
      );
    } catch (error: unknown) {
      showNotice(getErrorMessage(error), "error");
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleDeleteRecord = async (id: string) => {
    try {
      const response = await deleteCensusRecord(id);
      if (!response.success) {
        showNotice(response.error || "ไม่สามารถลบรายการได้", "error");
        return;
      }
      await loadRecords(true);
      showNotice("ลบรายการรายงานยอดผู้ป่วยเรียบร้อยแล้ว");
    } catch (error: unknown) {
      showNotice(getErrorMessage(error), "error");
    }
  };
  const handleEdit = (record: CensusRecord) => {
    setEditingRecord(record);
    router.push(`/entry?id=${encodeURIComponent(record.id)}`);
  };
  const handleCreate = () => {
    setEditingRecord(null);
    router.push("/entry");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-card text-foreground lg:flex lg:flex-col">
        <div className="flex h-24 items-center gap-3 border-b border-border px-7">
          <div className="grid size-10 place-items-center rounded-xl bg-brand-cyan text-brand-navy-strong shadow-sm">
            <Hospital className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{settingsSnapshot?.settings.wardName || "ตึกผู้ป่วยใน"}</p>
            <p className="truncate text-xs text-muted-foreground">{settingsSnapshot?.settings.hospitalName || "โรงพยาบาลองครักษ์"}</p>
          </div>
        </div>
        <nav
          className="flex flex-1 flex-col gap-1 px-4 py-8"
          aria-label="เมนูหลัก"
        >
          <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            จัดการเวร
          </p>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => item.id === "entry" && setEditingRecord(null)}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
                {active && (
                  <span className="ml-auto size-1.5 rounded-full bg-brand-emerald" />
                )}
              </Link>
            );
          })}
          {isWardHead && <Link
            href="/settings"
            className={`mt-4 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${activeTab === "settings" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            aria-current={activeTab === "settings" ? "page" : undefined}
          >
            <Settings className="size-4" />
            <span>ตั้งค่า</span>
            {activeTab === "settings" && <span className="ml-auto size-1.5 rounded-full bg-brand-emerald" />}
          </Link>}
        </nav>
        <div className="border-t border-border px-7 py-5 text-xs text-muted-foreground">
          <p>{settingsSnapshot?.settings.wardName || "IPD Census"}</p>
          <p className="mt-1">ข้อมูลใช้ร่วมกันจากฐานข้อมูลกลาง</p>
          {isWardHead && <Link href="/settings" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-cyan-strong hover:underline">
            <Settings className="size-4" /> ตั้งค่าระบบ
          </Link>}
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/95 px-4 backdrop-blur lg:ml-64 lg:px-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="min-w-0 lg:hidden">
            <p className="truncate text-sm font-semibold">{settingsSnapshot?.settings.wardName || "ตึกผู้ป่วยใน"}</p>
            <p className="hidden truncate text-xs text-muted-foreground min-[360px]:block">{settingsSnapshot?.settings.hospitalName || "โรงพยาบาลองครักษ์"}</p>
          </div>
          <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
            <Database className="size-4" />
            <span>ระบบบันทึกยอดผู้ป่วย</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AccountControl />
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-7 lg:ml-64 lg:px-10 lg:pb-12">
        {activeTab !== "settings" && <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              รายงานยอดผู้ป่วยประจำเวร
            </h1>
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {(settingsSnapshot?.settings.wardName || "ตึกผู้ป่วยใน")} · ประจำวันที่{" "}
              {todayDate ? formatThaiDate(todayDate, true) : "กำลังโหลดวันที่…"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              บันทึกข้อมูลเพื่อส่งต่อการดูแลในเวรถัดไป
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">
              {lastSyncedAt
                ? `ซิงค์ล่าสุด ${formatUpdatedAt(lastSyncedAt, true)}`
                : "กำลังซิงค์ข้อมูล…"}
            </span>
              <span className="rounded-full border border-input bg-card px-2.5 py-1">
              {records.length} เวร
            </span>
          </div>
        </div>}
        {notice && (
          <Alert
            variant={notice.type === "error" ? "destructive" : "default"}
            className={
              notice.type === "error"
                ? "mb-6 border-destructive/30 bg-surface-danger text-destructive-strong"
                : "mb-6 border-brand-emerald/35 bg-surface-emerald text-foreground"
            }
          >
            <Activity />
            <AlertTitle>
              {notice.type === "error" ? "บันทึกไม่สำเร็จ" : "ดำเนินการแล้ว"}
            </AlertTitle>
            <AlertDescription>
              {notice.message}
              <button
                type="button"
                className="ml-3 underline underline-offset-2"
                onClick={() => setNotice(null)}
              >
                ปิด
              </button>
            </AlertDescription>
          </Alert>
        )}
        {(isLoading || isSettingsLoading) && activeTab !== "line" ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-52 bg-muted" />
            <Skeleton className="h-36 bg-muted" />
          </div>
        ) : loadError && records.length === 0 ? (
          <Alert
            variant="destructive"
            className="border-destructive/30 bg-surface-danger text-destructive-strong"
          >
            <Activity />
            <AlertTitle>โหลดข้อมูลไม่สำเร็จ</AlertTitle>
            <AlertDescription>
              <span>{loadError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-3 min-h-11 border-destructive/35 bg-card text-destructive"
                onClick={() => void loadRecords()}
              >
                ลองใหม่
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {activeTab === "settings" && (
              <SettingsPanel
                settings={settingsSnapshot?.settings || null}
                lineStatus={settingsSnapshot?.lineStatus || null}
                groups={settingsSnapshot?.groups || []}
                loadError={settingsError}
                canManageUsers={isWardHead}
                onSaved={(saved) => {
                  setSettingsSnapshot((current) =>
                    current
                      ? { ...current, settings: saved }
                      : {
                          settings: saved,
                          lineStatus: {
                            accessTokenConfigured: false,
                            webhookSecretConfigured: false,
                            workerLastSeenAt: null,
                          },
                          groups: [],
                        },
                  );
                  showNotice("บันทึกการตั้งค่าเรียบร้อยแล้ว");
                }}
              />
            )}
            {activeTab === "overview" && (
              <div className="flex flex-col gap-8">
                <LatestShiftOverview
                  records={records}
                  selectedRecord={selectedRecord}
                  onSelectRecord={setSelectedRecord}
                  onEditRecord={handleEdit}
                  onCreateNew={handleCreate}
                  onOpenLineGenerator={(record) =>
                    router.push(`/line?id=${encodeURIComponent(record.id)}`)
                  }
                  reportSettings={reportSettings}
                />
                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">ประวัติล่าสุด</h2>
                        <p className="text-sm text-muted-foreground">
                          รายการเวรที่บันทึกล่าสุด
                        </p>
                      </div>
                      <Link
                        className="text-sm font-medium text-brand-cyan-strong hover:underline"
                        href="/history"
                      >
                        ดูทั้งหมด
                      </Link>
                    </div>
                    <CensusRecordsTable
                      records={records.slice(0, 6)}
                      isLoading={false}
                      onEdit={handleEdit}
                      onDelete={handleDeleteRecord}
                      canDelete={isWardHead}
                      canExport={isWardHead}
                      onCreateNew={handleCreate}
                      onOpenLineGenerator={(record) =>
                        router.push(`/line?id=${encodeURIComponent(record.id)}`)
                      }
                      compact
                    />
                  </section>
                  <aside className="rounded-xl border border-brand-emerald/25 bg-surface-emerald p-5">
                    <h2 className="text-base font-semibold">ขั้นตอนถัดไป</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      เลือกเวรล่าสุดเพื่อทบทวนตัวเลข
                      หรือเริ่มบันทึกเวรใหม่เมื่อพร้อม
                    </p>
                    <Button
                      className="mt-5 w-full bg-brand-emerald-strong text-white hover:bg-brand-emerald-strong/90"
                      onClick={handleCreate}
                    >
                      <ClipboardList />
                      บันทึกยอดเวร
                    </Button>
                    <Link
                      href="/line"
                      className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-md border border-brand-emerald/35 text-sm font-medium text-brand-emerald-strong hover:bg-card"
                    >
                      <MessageSquareText className="size-4" />
                      สร้างข้อความ LINE
                    </Link>
                  </aside>
                </div>
              </div>
            )}
            {activeTab === "entry" && (
              <section className="rounded-xl border border-border bg-card p-5 shadow-[0_8px_24px_rgba(18,59,93,0.08)] sm:p-8">
                <div className="mb-7 flex items-start justify-between gap-4 border-b border-border pb-5">
                  <div>
                    <h2 className="text-2xl font-semibold">
                      {editingRecord
                        ? "แก้ไขยอดผู้ป่วยประจำเวร"
                        : "บันทึกยอดผู้ป่วยประจำเวร"}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {editingRecord ? "แก้ไขรายการเดิม · " : ""}
                      กรอกยอดผู้ป่วย การเคลื่อนไหว และประเภทผู้ป่วย
                      ระบบจะคำนวณเตียงว่างและภาระงานจากข้อมูลที่กรอก
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-input"
                    onClick={() => {
                      setEditingRecord(null);
                      router.push("/");
                    }}
                  >
                    ยกเลิก
                  </Button>
                </div>
                <CensusForm
                  key={editingRecord?.id ?? "new"}
                  initialRecord={editingRecord}
                  allRecords={records}
                  onSave={handleSaveRecord}
                  onCancel={() => {
                    setEditingRecord(null);
                    router.push("/");
                  }}
                  isSubmitting={isSubmitting}
                  defaultCapacity={settingsSnapshot?.settings.defaultCapacity}
                  reportSettings={reportSettings}
                />
              </section>
            )}
            {activeTab === "line" && (
              <section className="flex flex-col gap-5">
                {!settingsSnapshot ? (
                  isSettingsLoading ? (
                    <div
                      className="flex flex-col gap-5"
                      role="status"
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <Skeleton className="h-52 bg-muted" />
                      <p className="text-sm text-muted-foreground">
                        กำลังโหลดการตั้งค่า…
                      </p>
                    </div>
                  ) : (
                    <Alert
                      variant="destructive"
                      className="border-destructive/30 bg-surface-danger text-destructive-strong"
                    >
                      <Activity />
                      <AlertTitle>โหลดการตั้งค่าไม่สำเร็จ</AlertTitle>
                      <AlertDescription>
                        <span>
                          {settingsError || "ไม่สามารถโหลดการตั้งค่าได้ในขณะนี้"}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-3 min-h-11 border-destructive/35 bg-card text-destructive"
                          onClick={() => void loadSettings()}
                        >
                          ลองใหม่
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )
                ) : isLoading ? (
                  <div
                    className="flex flex-col gap-5"
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <Skeleton className="h-52 bg-muted" />
                    <p className="text-sm text-muted-foreground">
                      กำลังโหลดข้อมูลเวร…
                    </p>
                  </div>
                ) : loadError && records.length === 0 ? (
                  <Alert
                    variant="destructive"
                    className="border-destructive/30 bg-surface-danger text-destructive-strong"
                  >
                    <Activity />
                    <AlertTitle>โหลดข้อมูลไม่สำเร็จ</AlertTitle>
                    <AlertDescription>
                      <span>{loadError}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-3 min-h-11 border-destructive/35 bg-card text-destructive"
                        onClick={() => void loadRecords()}
                      >
                        ลองใหม่
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : activeLineRecord ? (
                  <LineReportGenerator
                    record={activeLineRecord}
                    allRecords={records}
                    onSelectRecord={(record) => {
                      setSelectedRecord(record);
                      router.replace(
                        `/line?id=${encodeURIComponent(record.id)}`,
                      );
                    }}
                    onCopied={showNotice}
                    reportSettings={reportSettings}
                  />
                ) : (
                  <EmptyState
                    onCreate={handleCreate}
                    title="ยังไม่มีรายการสำหรับสร้างข้อความ LINE"
                    description="บันทึกยอดผู้ป่วยอย่างน้อยหนึ่งเวร แล้วเลือกเวรเพื่อปรับแต่งข้อความส่งต่อ"
                  />
                )}
              </section>
            )}
            {activeTab === "history" && (
              <section>
                <div className="mb-5">
                  <h2 className="text-2xl font-semibold">
                    ประวัติรายงานยอดผู้ป่วย
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    ค้นหา กรอง แก้ไข ลบ หรือส่งออกข้อมูลที่บันทึกไว้
                  </p>
                </div>
                <CensusRecordsTable
                  records={records}
                  isLoading={false}
                  onEdit={handleEdit}
                  onDelete={handleDeleteRecord}
                  canDelete={isWardHead}
                  canExport={isWardHead}
                  onCreateNew={handleCreate}
                  onOpenLineGenerator={(record) =>
                    router.push(`/line?id=${encodeURIComponent(record.id)}`)
                  }
                />
              </section>
            )}
            {activeTab === "analytics" && (
              <CensusAnalytics
                records={records}
                onSelectRecord={(record) => {
                  setSelectedRecord(record);
                  router.push("/");
                }}
              />
            )}
          </>
        )}
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label="เมนูด้านล่าง"
        style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => item.id === "entry" && setEditingRecord(null)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs ${active ? "font-semibold text-brand-cyan-strong" : "text-muted-foreground"}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-5" />
              <span>{item.id === "entry" ? "บันทึก" : item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function EmptyState({
  onCreate,
  title,
  description,
}: {
  onCreate: () => void;
  title: string;
  description: string;
}) {
  return (
    <Empty className="rounded-xl border-border bg-card py-20">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-surface-emerald text-brand-emerald-strong">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/85"
          onClick={onCreate}
        >
          <Plus />
          บันทึกเวรแรก
        </Button>
      </EmptyContent>
    </Empty>
  );
}
