import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { chromium, Page } from "playwright";
import { contentHash } from "../src/lib/scrape/hash";
import { sendRowsToGoogleSheet } from "../src/lib/sheets";

type ParsedComment = {
  authorName: string;
  body: string;
  likeCount: number;
  writtenAt: Date | null;
};

type ParsedPost = {
  sourceUrl: string;
  cafeId: string;
  cafeName: string;
  title: string;
  authorName: string;
  publishedAt: Date | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  contentText: string;
  rawHtml: string;
  comments: ParsedComment[];
};

const prisma = new PrismaClient();
const SESSION_FILE =
  process.env.NAVER_CAFE_SESSION_FILE ||
  path.join(process.cwd(), "playwright", "storage", "naver-cafe-session.json");
const OUTPUT_DIR = path.join(process.cwd(), "outputs", "scrape-jobs");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asInt(input: string): number {
  const value = Number((input || "").replace(/[^\d]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function isAllowedByWords(text: string, includeWords: string[], excludeWords: string[]): boolean {
  const compact = text.replace(/\s+/g, "").toLowerCase();

  if (includeWords.length > 0) {
    const hit = includeWords.some((word) => compact.includes(word.toLowerCase()));
    if (!hit) return false;
  }

  if (excludeWords.length > 0) {
    const blocked = excludeWords.some((word) => compact.includes(word.toLowerCase()));
    if (blocked) return false;
  }

  return true;
}

function toDateSafe(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function clampByAutoThreshold(posts: ParsedPost[], useAutoFilter: boolean, minView: number | null, minComment: number | null): ParsedPost[] {
  if (!useAutoFilter && minView === null && minComment === null) {
    return posts;
  }

  let appliedMinView = minView;
  let appliedMinComment = minComment;

  if (useAutoFilter) {
    const sortedViews = posts.map((p) => p.viewCount).sort((a, b) => a - b);
    const sortedComments = posts.map((p) => p.commentCount).sort((a, b) => a - b);

    const mid = Math.floor(posts.length / 2);
    if (appliedMinView === null) appliedMinView = sortedViews[mid] || 0;
    if (appliedMinComment === null) appliedMinComment = sortedComments[mid] || 0;
  }

  return posts.filter((p) => {
    if (appliedMinView !== null && p.viewCount < appliedMinView) return false;
    if (appliedMinComment !== null && p.commentCount < appliedMinComment) return false;
    return true;
  });
}

async function collectArticleUrls(page: Page, cafeId: string, keywords: string[], maxUrls: number): Promise<string[]> {
  const urls = new Set<string>();

  for (const keyword of keywords) {
    const query = encodeURIComponent(`${keyword} cafe.naver.com/${cafeId}`);
    const searchUrl = `https://search.naver.com/search.naver?where=web&query=${query}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(1200);

    const hrefs = await page.$$eval("a[href]", (elements) =>
      elements
        .map((el) => (el as HTMLAnchorElement).href)
        .filter((href) => href.includes("cafe.naver.com"))
    );

    for (const href of hrefs) {
      if (!href.includes("cafe.naver.com")) continue;
      if (!href.includes(cafeId) && !href.includes("/articles/") && !href.includes("ArticleRead")) continue;

      urls.add(href);
      if (urls.size >= maxUrls) break;
    }

    if (urls.size >= maxUrls) break;
    await sleep(700);
  }

  return Array.from(urls);
}

async function parsePost(page: Page, sourceUrl: string, cafeId: string, cafeName: string): Promise<ParsedPost | null> {
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
  await sleep(1200);

  if (page.url().includes("nidlogin")) {
    throw new Error("네이버 로그인 세션이 만료되었습니다.");
  }

  const title =
    (await page.locator("h3, h2, .title_text").first().textContent())?.trim() ||
    (await page.title());

  const contentCandidates = [
    ".se-main-container",
    "#tbody",
    "#postContent",
    ".ContentRenderer",
    "article",
    "body",
  ];

  let contentText = "";
  let rawHtml = "";
  for (const selector of contentCandidates) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) continue;

    const text = ((await loc.innerText()) || "").trim();
    if (text.length < 20) continue;

    contentText = text;
    rawHtml = await loc.innerHTML();
    break;
  }

  if (!contentText) {
    return null;
  }

  const fullText = await page.locator("body").innerText();
  const viewMatch = fullText.match(/조회\s*([\d,]+)/);
  const likeMatch = fullText.match(/좋아요\s*([\d,]+)/);
  const commentMatch = fullText.match(/댓글\s*([\d,]+)/);

  const authorName =
    (await page.locator(".nickname, .nick, .author, .name").first().textContent())?.trim() ||
    "";

  const publishedAttr = await page.locator("time").first().getAttribute("datetime").catch(() => null);
  const publishedText = (await page.locator("time").first().textContent().catch(() => null)) || null;
  const publishedAt = toDateSafe(publishedAttr || publishedText);

  const comments = await page.$$eval("li, div", (elements) => {
    const rows: Array<{ authorName: string; body: string; likeCount: number }> = [];

    for (const el of elements) {
      const cls = (el as HTMLElement).className || "";
      if (typeof cls !== "string") continue;
      if (!cls.toLowerCase().includes("comment")) continue;

      const text = (el.textContent || "").trim();
      if (!text || text.length < 2 || text.length > 500) continue;

      const like = Number((text.match(/좋아요\s*([\d,]+)/)?.[1] || "0").replace(/[^\d]/g, "")) || 0;
      rows.push({
        authorName: "",
        body: text,
        likeCount: like,
      });

      if (rows.length >= 120) break;
    }

    return rows;
  });

  return {
    sourceUrl: page.url(),
    cafeId,
    cafeName,
    title: title || "",
    authorName,
    publishedAt,
    viewCount: asInt(viewMatch?.[1] || "0"),
    likeCount: asInt(likeMatch?.[1] || "0"),
    commentCount: asInt(commentMatch?.[1] || "0"),
    contentText,
    rawHtml,
    comments: comments.map((comment) => ({
      authorName: comment.authorName,
      body: comment.body,
      likeCount: comment.likeCount,
      writtenAt: null,
    })),
  };
}

function writeCsv(jobId: string, posts: ParsedPost[]): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const filePath = path.join(OUTPUT_DIR, `job-${jobId}-${Date.now()}.csv`);
  const header = [
    "sourceUrl",
    "cafeId",
    "cafeName",
    "title",
    "authorName",
    "publishedAt",
    "viewCount",
    "likeCount",
    "commentCount",
    "contentText",
  ];

  const rows = posts.map((post) =>
    [
      post.sourceUrl,
      post.cafeId,
      post.cafeName,
      post.title,
      post.authorName,
      post.publishedAt?.toISOString() || "",
      String(post.viewCount),
      String(post.likeCount),
      String(post.commentCount),
      post.contentText.replace(/\s+/g, " ").slice(0, 5000),
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",")
  );

  fs.writeFileSync(filePath, [header.join(","), ...rows].join("\n"), "utf8");
  return filePath;
}

async function run(jobId: string) {
  const job = await prisma.scrapeJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("작업이 존재하지 않습니다.");

  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error("카페 로그인 세션 파일이 없습니다. npm run cafe:login을 먼저 실행하세요.");
  }

  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });

  const keywords = JSON.parse(job.keywords || "[]") as string[];
  const includeWords = JSON.parse(job.includeWords || "[]") as string[];
  const excludeWords = JSON.parse(job.excludeWords || "[]") as string[];
  const cafeIds = JSON.parse(job.cafeIds || "[]") as string[];
  const cafeNames = JSON.parse(job.cafeNames || "[]") as string[];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    locale: "ko-KR",
    viewport: { width: 1366, height: 900 },
  });

  const page = await context.newPage();
  const collected: ParsedPost[] = [];

  try {
    for (let i = 0; i < cafeIds.length; i += 1) {
      const cafeId = cafeIds[i];
      const cafeName = cafeNames[i] || cafeId;

      const urls = await collectArticleUrls(
        page,
        cafeId,
        keywords,
        Math.max(10, Math.ceil(job.maxPosts / Math.max(1, cafeIds.length)))
      );

      for (const url of urls) {
        if (collected.length >= job.maxPosts) break;

        const parsed = await parsePost(page, url, cafeId, cafeName).catch(() => null);
        if (!parsed) continue;

        const normalizedForMatch = `${parsed.title}\n${parsed.contentText}`;
        if (!isAllowedByWords(normalizedForMatch, includeWords, excludeWords)) {
          continue;
        }

        if (job.fromDate && parsed.publishedAt && parsed.publishedAt < job.fromDate) continue;
        if (job.toDate && parsed.publishedAt && parsed.publishedAt > job.toDate) continue;

        collected.push(parsed);
        await sleep(900 + Math.floor(Math.random() * 600));
      }

      if (collected.length >= job.maxPosts) break;
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const filtered = clampByAutoThreshold(
    collected,
    job.useAutoFilter,
    job.minViewCount,
    job.minCommentCount
  );

  const finalPosts = filtered.slice(0, job.maxPosts);

  let savedCount = 0;
  const postRows = [] as Array<{
    jobId: string;
    sourceUrl: string;
    cafeId: string;
    cafeName: string;
    title: string;
    authorName: string;
    publishedAt: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    contentText: string;
  }>;
  const commentRows = [] as Array<{
    jobId: string;
    sourceUrl: string;
    cafeId: string;
    cafeName: string;
    commentAuthor: string;
    commentBody: string;
    commentLikeCount: number;
    commentWrittenAt: string;
  }>;

  for (const post of finalPosts) {
    const hash = contentHash(post.contentText);
    const existed = await prisma.scrapePost.findUnique({ where: { contentHash: hash } });
    if (existed) continue;

    const created = await prisma.scrapePost.create({
      data: {
        jobId,
        sourceUrl: post.sourceUrl,
        cafeId: post.cafeId,
        cafeName: post.cafeName,
        title: post.title,
        authorName: post.authorName,
        publishedAt: post.publishedAt,
        viewCount: post.viewCount,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        contentText: post.contentText,
        contentHash: hash,
        rawHtml: post.rawHtml,
      },
    });

    for (const comment of post.comments) {
      await prisma.scrapeComment.create({
        data: {
          postId: created.id,
          authorName: comment.authorName,
          body: comment.body,
          likeCount: comment.likeCount,
          writtenAt: comment.writtenAt,
        },
      });

      commentRows.push({
        jobId,
        sourceUrl: post.sourceUrl,
        cafeId: post.cafeId,
        cafeName: post.cafeName,
        commentAuthor: comment.authorName,
        commentBody: comment.body,
        commentLikeCount: comment.likeCount,
        commentWrittenAt: comment.writtenAt?.toISOString() || "",
      });
    }

    postRows.push({
      jobId,
      sourceUrl: post.sourceUrl,
      cafeId: post.cafeId,
      cafeName: post.cafeName,
      title: post.title,
      authorName: post.authorName,
      publishedAt: post.publishedAt?.toISOString() || "",
      viewCount: post.viewCount,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      contentText: post.contentText,
    });

    savedCount += 1;
  }

  const csvPath = writeCsv(jobId, finalPosts);

  let syncedCount = 0;
  try {
    await sendRowsToGoogleSheet(postRows, commentRows);
    syncedCount = postRows.length;
  } catch (error) {
    console.error("Google Sheet 동기화 실패:", error);
  }

  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCESS",
      resultCount: savedCount,
      sheetSynced: syncedCount,
      resultPath: csvPath,
      completedAt: new Date(),
    },
  });
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    throw new Error("jobId가 필요합니다. usage: npm run scrape:job -- <jobId>");
  }

  try {
    await run(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    }).catch(() => undefined);

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
