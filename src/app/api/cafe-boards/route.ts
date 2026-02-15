import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

type BoardResponse = {
  boardName: string;
};

type BodyPayload = {
  cafeIds?: unknown;
  keywords?: unknown;
};

type BoardCacheEntry = {
  boards: string[];
  expiresAt: number;
};

const BOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const BOARD_CACHE = new Map<string, BoardCacheEntry>();

function parseStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeBoardToken(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function extractClubIdFromText(input: string): string {
  const str = String(input || "");
  const patterns = [
    /clubid=(\d{4,})/i,
    /cafeId=(\d{4,})/i,
    /["']?clubId["']?\s*:\s*(\d{4,})/i,
    /\/(?:ca-fe\/cafes|ca-fe\/cafe)\/(\d{4,})/i,
    /\/(?:cafes|ca-fe\/cafes)\/(\d{4,})\//i,
  ];

  for (const re of patterns) {
    const m = str.match(re);
    if (m?.[1]) return String(m[1]);
  }
  return "";
}

function normalizeCafeId(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function makeBoardCacheKey(cafeIds: string[]): string {
  return cafeIds
    .map((value) => normalizeCafeId(value))
    .filter(Boolean)
    .sort()
    .join("|");
}

function normalizeBoardName(boardName: string): string | null {
  const name = String(boardName || "").trim();
  if (!name) return null;
  if (name.length > 80) return null;
  const token = normalizeBoardToken(name);
  if (!token) return null;
  return name;
}

function extractCafeNumericId(cafeId: string): string {
  return String(cafeId || "").trim();
}

async function resolveCafeNumericId(rawCafeId: string): Promise<string> {
  const normalized = extractCafeNumericId(rawCafeId);
  if (!normalized) return "";
  if (/^\d+$/.test(normalized)) return normalized;

  try {
    const response = await fetch(`https://cafe.naver.com/${encodeURIComponent(normalized)}`, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
      },
      redirect: "follow",
    });

    const matchedFromUrl = extractClubIdFromText(response.url || "");
    if (matchedFromUrl) return matchedFromUrl;

    const html = await response.text().catch(() => "");
    return extractClubIdFromText(html);
  } catch {
    return "";
  }
}

async function fetchBoardsFromSearch(
  cafeNumericId: string,
  keyword: string
): Promise<BoardResponse[]> {
  const q = String(keyword || "").trim();
  const params = new URLSearchParams({
    cafeId: String(cafeNumericId),
    searchBy: "1",
    sortBy: "date",
    page: "1",
    perPage: "30",
    adUnit: "MW_CAFE_BOARD",
    ad: "true",
  });

  if (q) params.set("query", q);

  const url =
    `https://apis.naver.com/cafe-web/cafe-mobile/CafeMobileWebArticleSearchListV4` +
    `?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`board search failed ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const boardNameCandidates: string[] = [];

  const directMenus = [
    payload?.message?.result?.menuList,
    payload?.message?.result?.menus,
    payload?.message?.result?.boardList,
    payload?.message?.result?.articleListMeta?.boards,
  ];
  for (const list of directMenus) {
    if (!Array.isArray(list)) continue;
    for (const node of list) {
      const boardName = String(
        node?.name ||
          node?.menuName ||
          node?.title ||
          node?.boardName ||
          node?.menuTitle ||
          node?.board ||
          ""
      ).trim();
      if (!boardName) continue;
      boardNameCandidates.push(boardName);
    }
  }

  const list = payload?.message?.result?.articleList || [];
  const boards: BoardResponse[] = [];

  for (const boardName of boardNameCandidates) {
    if (!normalizeBoardName(boardName)) continue;
    boards.push({ boardName });
  }

  for (const row of list) {
    if (row?.type !== "ARTICLE") continue;
    const item = row?.item;
    if (!item) continue;
    const boardName = String(
      item.boardName ||
        item.boardTitle ||
        item.menuName ||
        item.menuTitle ||
        item.board ||
        item.menu ||
        item.boardType ||
        ""
    ).trim();
    if (!boardName) continue;
    boards.push({ boardName });
  }
  return boards;
}

function getCachedBoards(cacheKey: string): string[] | null {
  const cached = BOARD_CACHE.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    BOARD_CACHE.delete(cacheKey);
    return null;
  }
  return cached.boards.slice();
}

function setCachedBoards(cacheKey: string, boards: string[]) {
  BOARD_CACHE.set(cacheKey, {
    boards,
    expiresAt: Date.now() + BOARD_CACHE_TTL_MS,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  try {
    let body: BodyPayload;
    try {
      body = (await request.json()) as BodyPayload;
    } catch {
      return NextResponse.json(
        { success: false, error: "요청 바디 JSON 파싱에 실패했습니다." },
        { status: 400 }
      );
    }

    const cafeIds = parseStringArray(body?.cafeIds).filter(Boolean);
    const keywords = parseStringArray(body?.keywords);

    if (cafeIds.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const cacheKey = makeBoardCacheKey(cafeIds);
    const cached = getCachedBoards(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const searchKeywords = keywords.length > 0 ? keywords.slice(0, 2) : [""]; // query-independent retrieval
    const boardNameSet = new Set<string>();
    const searchPool = Array.from(new Set(searchKeywords.map((keyword) => String(keyword).trim()).filter(Boolean)));
    const candidateQueries = searchPool.length > 0 ? ["", ...searchPool] : [""];

    for (const rawCafeId of cafeIds) {
      const numericId = await resolveCafeNumericId(rawCafeId);
      if (!numericId) continue;
      for (const keyword of candidateQueries) {
        try {
          const boards = await fetchBoardsFromSearch(numericId, keyword);
          for (const board of boards) {
            const normalized = normalizeBoardToken(board.boardName);
            const pretty = normalizeBoardName(board.boardName);
            if (normalized && pretty) {
              boardNameSet.add(pretty);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
          if (boardNameSet.size >= 80) break;
        } catch {
          // Ignore board-fetch failure for this cafe/keyword and continue.
        }
      }
    }

    const boardNames = Array.from(boardNameSet).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
    setCachedBoards(makeBoardCacheKey(cafeIds), boardNames);
    return NextResponse.json({ success: true, data: boardNames });
  } catch (error) {
    console.error("게시판 목록 조회 실패:", error);
    return NextResponse.json(
      { success: false, error: "게시판 목록 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
