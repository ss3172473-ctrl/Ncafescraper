import "dotenv/config";

type SearchRow = {
  articleId: number;
  subject: string;
  readCount: number;
  commentCount: number;
  likeCount: number;
  boardName: string;
};

type SearchApiRow = {
  type?: string;
  item?: {
    articleId?: string | number;
    subject?: string;
    readCount?: string | number;
    commentCount?: string | number;
    likeItCount?: string | number;
    likeCount?: string | number;
    boardName?: string;
    boardTitle?: string;
    menuName?: string;
    menu?: string;
    menuTitle?: string;
    board?: string;
  };
};

type SearchApiResponse = {
  message?: {
    result?: {
      articleList?: SearchApiRow[];
    };
  };
};

function parseIntSafe(v: unknown): number {
  const n = Number(String(v || "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "accept": "application/json, text/plain, */*",
      "referer": "https://cafe.naver.com/",
    },
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${url}`);
  }

  return (await resp.json()) as T;
}

function normalizeUrl(pageNo: number, cafeId: string, keyword: string, size: number) {
  const q = encodeURIComponent(keyword);
  return [
    "https://apis.naver.com/cafe-web/cafe-mobile/CafeMobileWebArticleSearchListV4",
    `?cafeId=${encodeURIComponent(cafeId)}`,
    `&query=${q}`,
    "&searchBy=1&sortBy=date",
    `&page=${pageNo}`,
    `&perPage=${size}`,
    "&adUnit=MW_CAFE_BOARD&ad=true",
  ].join("");
}

async function main() {
  const [cafeIdArg, keywordArg, pagesArg, sizeArg] = process.argv.slice(2);
  if (!cafeIdArg || !keywordArg) {
    throw new Error(
      "usage: npx ts-node --project tsconfig.scripts.json scripts/debug-cafe-search.ts <cafeId> <keyword> [pages=4] [size=50]"
    );
  }

  const cafeId = String(cafeIdArg).trim();
  const keyword = String(keywordArg).trim();
  const pages = Math.max(1, Number(pagesArg || "4"));
  const size = Math.max(1, Math.min(100, Number(sizeArg || "50")));

  const allRows: SearchRow[] = [];

  for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
    const url = normalizeUrl(pageNo, cafeId, keyword, size);
    console.log(`page ${pageNo} request=${url}`);

    const json = await fetchJson<SearchApiResponse>(url);
    const list = json?.message?.result?.articleList;
    if (!Array.isArray(list) || list.length === 0) {
      console.log(`page ${pageNo}: no rows, stop`);
      break;
    }

    const rows: SearchRow[] = [];
    for (const row of list) {
      if (row?.type !== "ARTICLE") continue;
      const item = row.item;
      if (!item?.articleId) continue;

      const subject = String(item.subject || "").replace(/<[^>]*>/g, "").trim();
      rows.push({
        articleId: Number(item.articleId),
        subject,
        readCount: parseIntSafe(item.readCount),
        commentCount: parseIntSafe(item.commentCount),
        likeCount: parseIntSafe(item.likeItCount ?? item.likeCount),
        boardName: String(
          item.boardName || item.boardTitle || item.menuName || item.menu || item.menuTitle || item.board || ""
        ).trim(),
      });
    }

    console.log(`page ${pageNo} rows=${rows.length}`);
    for (const r of rows) {
      console.log(`${r.articleId}\t${r.readCount}\t${r.commentCount}\t${r.likeCount}\t${r.boardName}\t${r.subject}`);
    }

    allRows.push(...rows);

    if (rows.length < size) {
      console.log(`page ${pageNo} returned partial (${rows.length} < ${size}), stop.`);
      break;
    }
  }

  console.log(`TOTAL ${allRows.length}`);
  const target = allRows.find((r) =>
    r.subject.includes("트 top반") || r.subject.includes("폴리") || r.subject.includes("매그라면")
  );

  if (target) {
    console.log("MATCH_TARGET", JSON.stringify(target));
  } else {
    console.log("NO_MATCH_TARGET");
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
