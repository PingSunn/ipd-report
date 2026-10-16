import { Suspense } from "react";
import App from "../../App";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6" role="status">กำลังโหลดการตั้งค่า…</main>}>
      <App />
    </Suspense>
  );
}
