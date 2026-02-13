import { chromium } from "playwright";
import { NAVER_CAFE_SESSION_FILE } from "@/lib/naver/session";

export interface JoinedCafe {
  cafeId: string;
  name: string;
  url: string;
}

function extractCafeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "cafe.naver.com") {
      return null;
    }

    const pathname = parsed.pathname.replace(/^\//, "").trim();
    if (!pathname || pathname.toLowerCase().includes("article")) {
      return null;
    }

    if (pathname.includes("/")) {
      return null;
    }

    return pathname;
  } catch {
    return null;
  }
}

export async function fetchJoinedCafes(): Promise<JoinedCafe[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: NAVER_CAFE_SESSION_FILE,
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();

  try {
    await page.goto("https://section.cafe.naver.com/ca-fe/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    if (page.url().includes("nidlogin")) {
      throw new Error("네이버 카페 세션이 만료되었습니다. `npm run cafe:login` 후 다시 시도하세요.");
    }

    const anchors = await page.$$eval("a[href*='cafe.naver.com']", (elements) =>
      elements
        .map((el) => {
          const href = (el as HTMLAnchorElement).href || "";
          const name = (el.textContent || "").trim();
          return { href, name };
        })
        .filter((v) => !!v.href)
    );

    const unique = new Map<string, JoinedCafe>();

    for (const item of anchors) {
      const cafeId = extractCafeId(item.href);
      if (!cafeId) continue;
      if (cafeId === "mycafelist.nhn") continue;

      const url = `https://cafe.naver.com/${cafeId}`;
      const name = item.name || cafeId;

      if (!unique.has(cafeId)) {
        unique.set(cafeId, { cafeId, name, url });
      }
    }

    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  } finally {
    await context.close();
    await browser.close();
  }
}
