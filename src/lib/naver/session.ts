import fs from "fs";
import path from "path";

export const NAVER_CAFE_SESSION_FILE =
  process.env.NAVER_CAFE_SESSION_FILE ||
  path.join(process.cwd(), "playwright", "storage", "naver-cafe-session.json");

export function getCafeSessionStatus() {
  const hasSession = fs.existsSync(NAVER_CAFE_SESSION_FILE);
  if (!hasSession) {
    return { hasSession: false, isValid: false, lastChecked: null as Date | null };
  }

  const stats = fs.statSync(NAVER_CAFE_SESSION_FILE);
  return {
    hasSession: true,
    isValid: true,
    lastChecked: stats.mtime,
  };
}
