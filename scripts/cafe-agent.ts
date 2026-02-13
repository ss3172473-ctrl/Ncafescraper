/**
 * 네이버 카페 자동 발행 스크립트 (MVP)
 * 사용법:
 * npm run cafe:publish -- --title "제목" --content "본문"
 * npm run cafe:publish -- --topic "주제" --link "https://example.com"
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Frame, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

chromium.use(StealthPlugin());

const AI_PROVIDER = (process.env.AI_PROVIDER || "openai").toLowerCase();
const NAVER_CAFE_WRITE_URL = process.env.NAVER_CAFE_WRITE_URL || "";
const SESSION_FILE =
  process.env.NAVER_CAFE_SESSION_FILE ||
  path.join(process.cwd(), "playwright", "storage", "naver-cafe-session.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "playwright", "screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const openai =
  AI_PROVIDER === "openai"
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

const gemini =
  AI_PROVIDER === "gemini"
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "")
    : null;

type CliOptions = {
  title?: string;
  content?: string;
  topic?: string;
  link?: string;
  headless: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = { headless: false };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];

    if (key === "--title" && val) {
      result.title = val;
      i++;
    } else if (key === "--content" && val) {
      result.content = val;
      i++;
    } else if (key === "--topic" && val) {
      result.topic = val;
      i++;
    } else if (key === "--link" && val) {
      result.link = val;
      i++;
    } else if (key === "--headless") {
      result.headless = true;
    }
  }

  return result;
}

async function generateWithAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (AI_PROVIDER === "gemini" && gemini) {
    const model = gemini.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 3000,
      },
    });
    const result = await model.generateContent(
      `[시스템]\n${systemPrompt}\n\n[요청]\n${userPrompt}`
    );
    return result.response.text();
  }

  if (openai) {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_completion_tokens: 3000,
    });
    return response.choices[0]?.message?.content || "";
  }

  throw new Error("AI 설정이 올바르지 않습니다. .env를 확인하세요.");
}

async function generateCafePost(
  topic: string,
  link?: string
): Promise<{ title: string; body: string }> {
  const systemPrompt =
    "당신은 네이버 카페 후기 작성자입니다. 자연스럽고 읽기 쉬운 한국어 문장으로 작성하세요.";

  const userPrompt = `주제: ${topic}
${link ? `참고 링크: ${link}` : ""}

아래 JSON 형식으로만 답하세요.
{
  "title": "카페 글 제목 (20~35자)",
  "body": "인사, 본론, 장단점, 마무리를 포함한 700자 이상 본문"
}`;

  const raw = await generateWithAI(systemPrompt, userPrompt);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 응답 파싱 실패");
  const parsed = JSON.parse(match[0]);
  return {
    title: parsed.title || `${topic} 후기`,
    body: parsed.body || `${topic} 관련 내용을 작성해주세요.`,
  };
}

async function getEditorFrame(page: Page): Promise<Frame | Page> {
  await page.waitForTimeout(1500);
  const frame =
    page.frame({ name: "cafe_main" }) ||
    page
      .frames()
      .find((f) => f.url().includes("ArticleWrite") || f.url().includes("WriteForm"));

  return frame || page;
}

async function fillTitle(frame: Frame | Page, title: string): Promise<void> {
  const selectors = [
    'input[name="subject"]',
    'textarea[name="subject"]',
    'input[placeholder*="제목"]',
    'textarea[placeholder*="제목"]',
    '[contenteditable="true"][data-placeholder*="제목"]',
  ];

  for (const selector of selectors) {
    const el = await frame.$(selector);
    if (el) {
      await el.click();
      await el.fill(title);
      return;
    }
  }

  throw new Error("제목 입력 필드를 찾지 못했습니다.");
}

async function fillBody(frame: Frame | Page, body: string): Promise<void> {
  const editorSelectors = [
    '.se-main-container [contenteditable="true"]',
    '.toastui-editor-contents[contenteditable="true"]',
    '[contenteditable="true"]',
    "textarea",
  ];

  for (const selector of editorSelectors) {
    const el = await frame.$(selector);
    if (!el) continue;

    await el.click();
    const lines = body.split("\n");
    for (const line of lines) {
      if (line.trim().length > 0) {
        await frame.keyboard.type(line, { delay: 8 });
      }
      await frame.keyboard.press("Enter");
    }
    return;
  }

  throw new Error("본문 에디터를 찾지 못했습니다.");
}

async function clickPublish(frame: Frame | Page): Promise<boolean> {
  const textCandidates = ["등록", "발행", "완료", "확인"];
  let clicked = false;

  const buttons = await frame.$$("button, a");
  for (const button of buttons) {
    const text = ((await button.textContent()) || "").trim();
    if (!text) continue;
    if (textCandidates.some((t) => text.includes(t))) {
      try {
        await button.click({ force: true });
        await frame.waitForTimeout(1200);
        clicked = true;
      } catch {
        // 다음 후보 진행
      }
    }
  }

  const url =
    "url" in frame && typeof frame.url === "function" ? frame.url() : "";
  if (url.includes("/articles/") || url.includes("ArticleRead")) {
    return true;
  }
  return clicked;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!NAVER_CAFE_WRITE_URL) {
    throw new Error("NAVER_CAFE_WRITE_URL 환경변수가 필요합니다.");
  }
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error("카페 세션 파일이 없습니다. npm run cafe:login 을 먼저 실행하세요.");
  }

  let title = options.title;
  let content = options.content;

  if (!title || !content) {
    if (!options.topic) {
      throw new Error(
        "제목/본문을 직접 넣거나 --topic 옵션을 사용해야 합니다."
      );
    }
    const generated = await generateCafePost(options.topic, options.link);
    title = title || generated.title;
    content = content || generated.body;
  }

  console.log("카페 발행 시작");
  console.log(`- 제목: ${title}`);
  console.log(`- 본문 길이: ${content?.length || 0}자`);

  const browser = await chromium.launch({
    headless: options.headless,
    slowMo: options.headless ? 0 : 60,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1366, height: 900 },
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  await page.addInitScript(`
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  `);

  try {
    await page.goto(NAVER_CAFE_WRITE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const frame = await getEditorFrame(page);
    await fillTitle(frame, title || "");
    await page.waitForTimeout(300);

    await fillBody(frame, content || "");
    await page.waitForTimeout(500);

    const ss1 = path.join(SCREENSHOT_DIR, `cafe-before-publish-${Date.now()}.png`);
    await page.screenshot({ path: ss1, fullPage: true });

    const published = await clickPublish(frame);
    await page.waitForTimeout(3000);

    const ss2 = path.join(SCREENSHOT_DIR, `cafe-after-publish-${Date.now()}.png`);
    await page.screenshot({ path: ss2, fullPage: true });

    console.log(`스크린샷 저장: ${ss1}`);
    console.log(`스크린샷 저장: ${ss2}`);
    console.log(`최종 URL: ${page.url()}`);
    console.log(published ? "발행 처리 완료(확인 필요)" : "발행 실패");
  } finally {
    await context.storageState({ path: SESSION_FILE });
    await browser.close();
  }
}

main().catch((error) => {
  console.error("오류:", error.message || error);
  process.exit(1);
});
