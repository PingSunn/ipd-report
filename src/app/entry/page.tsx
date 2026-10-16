import { Suspense } from "react";
import App from "../../App";

export default function Page() {
  return <Suspense fallback={<main className="p-6" role="status">กำลังโหลดข้อมูลเวร…</main>}><App /></Suspense>;
}
