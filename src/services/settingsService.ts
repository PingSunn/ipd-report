import type {
  LineHistoryItem,
  LineHistoryResponse,
  SettingsDto,
  SettingsResponse,
  SettingsUpdateInput,
} from "../types/settings";

export type SettingsSnapshot = Pick<SettingsResponse, "settings" | "lineStatus" | "groups">;

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : "ไม่สามารถดำเนินการกับการตั้งค่าได้ในขณะนี้";
    const error = new Error(message) as Error & { fieldErrors?: Record<string, string> };
    if (typeof body === "object" && body !== null && "fieldErrors" in body && typeof body.fieldErrors === "object" && body.fieldErrors !== null) {
      error.fieldErrors = body.fieldErrors as Record<string, string>;
    }
    throw error;
  }
  return body as T;
}

export async function getSettings(): Promise<SettingsSnapshot> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  return readJson<SettingsResponse>(response);
}

export async function saveSettings(input: SettingsUpdateInput): Promise<SettingsDto> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson<{ success: true; settings: SettingsDto }>(response);
  return body.settings;
}

export async function getLineHistory(limit = 100): Promise<LineHistoryItem[]> {
  const response = await fetch(`/api/line/history?limit=${limit}`, { cache: "no-store" });
  const body = await readJson<LineHistoryResponse>(response);
  return body.history;
}
