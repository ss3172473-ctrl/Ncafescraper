export interface SheetPostPayload {
  jobId: string;
  sourceUrl: string;
  cafeId: string;
  cafeName: string;
  cafeUrl: string;
  title: string;
  authorName: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  bodyText: string;
  commentsText: string;
  contentText: string;
}

// Google Sheets has a per-cell character limit (commonly ~50k). We keep a safety margin
// to avoid Apps Script setValues failures, while storing the full text in DB/CSV.
const SHEET_POSTS_V2_KEY = "postRowsV2";

function clampForSheetCell(input: string, maxChars = 45000): string {
  const s = input || "";
  if (s.length <= maxChars) return s;
  const suffix = `\n\n[TRUNCATED: ${s.length} chars]`;
  return s.slice(0, Math.max(0, maxChars - suffix.length)) + suffix;
}

export async function sendRowsToGoogleSheet(
  postRows: SheetPostPayload[]
): Promise<void> {
  // Fallback to the specific URL provided by the user if env var is missing
  const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzgVfjMf1F2sp6kJNKf2QG7OZMawyD9GJEOeBsEsPnSzhHka5ElQ33f1jZcsVpjobsP3g/exec";
  const endpoint = process.env.GSHEET_WEBHOOK_URL || DEFAULT_WEBHOOK_URL;

  if (!endpoint) {
    return;
  }

  const safePostRows = postRows.map((r) => ({
    ...r,
    bodyText: clampForSheetCell(r.bodyText || ""),
    commentsText: clampForSheetCell(r.commentsText || ""),
    contentText: clampForSheetCell(r.contentText),
  }));

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Always send one payload only => posts_v2 sheet only.
    body: JSON.stringify({ [SHEET_POSTS_V2_KEY]: safePostRows }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheet sync failed: ${response.status} ${text}`);
  }
}
