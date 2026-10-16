import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/500.css";
import "@fontsource/noto-sans-thai/600.css";
import "@fontsource/noto-sans-thai/700.css";
import "../index.css";
import { AuthGate, AuthProvider } from "../components/auth/AuthProvider";

export const metadata: Metadata = {
  title: "รายงานยอดผู้ป่วยใน · โรงพยาบาลองครักษ์",
  description: "บันทึกยอดผู้ป่วยรายเวร สรุปส่งต่อเวร และติดตามสถิติหอผู้ป่วยใน",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="th"><body><AuthProvider><AuthGate>{children}</AuthGate></AuthProvider></body></html>;
}
