import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { decryptString } from "../src/lib/crypto";

chromium.use(StealthPlugin());

const prisma = new PrismaClient();
const SESSION_FILE =
    process.env.NAVER_CAFE_SESSION_FILE ||
    path.join(process.cwd(), "playwright", "storage", "naver-cafe-session.json");
const STORAGE_STATE_KEY = "naverCafeStorageStateEnc";

type StorageStateObject = { cookies: any[]; origins: any[] };

function isStorageStateObject(value: unknown): value is StorageStateObject {
    if (!value || typeof value !== "object") return false;
    const v = value as any;
    return Array.isArray(v.cookies) && Array.isArray(v.origins);
}

async function loadStorageState(): Promise<string | StorageStateObject> {
    // Local/dev: use the file-based storageState if it exists.
    if (SESSION_FILE && fs.existsSync(SESSION_FILE)) {
        console.log(`[check] Using local session file: ${SESSION_FILE}`);
        return SESSION_FILE;
    }

    // Cloud/Worker: read encrypted storageState from DB Setting.
    const secret = process.env.APP_AUTH_SECRET || "";
    const row = await prisma.setting.findUnique({ where: { key: STORAGE_STATE_KEY } });

    if (!row?.value) {
        throw new Error("네이버 카페 세션(storageState)이 없습니다. 로컬 파일이나 DB에 세션이 필요합니다.");
    }

    console.log(`[check] Using session from DB (Setting: ${STORAGE_STATE_KEY})`);

    let json: string;
    try {
        json = decryptString(row.value, secret);
    } catch (error: any) {
        throw new Error(`세션 복호화 실패: ${error.message}`);
    }

    const parsed = JSON.parse(json);
    if (!isStorageStateObject(parsed)) {
        throw new Error("storageState JSON 포맷이 올바르지 않습니다.");
    }
    return parsed;
}

async function main() {
    console.log("=".repeat(50));
    console.log("네이버 세션 유효성 검사");
    console.log("=".repeat(50));

    let storageState: string | StorageStateObject;
    try {
        storageState = await loadStorageState();
    } catch (error: any) {
        console.error(`❌ 세션 로드 실패: ${error.message}`);
        process.exit(1);
    }

    const browser = await chromium.launch({
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
    });

    try {
        const context = await browser.newContext({
            storageState: typeof storageState === "string" ? storageState : undefined,
            viewport: { width: 1280, height: 800 },
            locale: "ko-KR",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });

        if (typeof storageState !== "string") {
            await context.addCookies(storageState.cookies);
        }

        const page = await context.newPage();
        await page.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    `);

        console.log("🔄 네이버 접속 중...");
        await page.goto("https://cafe.naver.com", { waitUntil: "domcontentloaded", timeout: 30000 });

        // 로그인 여부 확인: 쿠키 확인 및 특정 UI 요소 확인
        const cookies = await context.cookies();
        const cookieNames = new Set(cookies.map((c) => c.name));
        const hasNidCookies = cookieNames.has("NID_AUT") && cookieNames.has("NID_SES");

        // "로그인" 버튼이 있으면 로그아웃된 상태일 가능성이 높음
        const loginButton = await page.$('a:has-text("로그인")');
        const myInfo = await page.$('.gnb_my_interface, .gnb_my_ly');

        console.log("");
        if (hasNidCookies && !loginButton) {
            console.log("✅ 세션 유효: 네이버 로그인 상태가 유지되고 있습니다.");

            // 사용자 닉네임 확인 시도
            try {
                const nickname = await page.textContent('.gnb_name, .nickname');
                if (nickname) {
                    console.log(`👤 로그인 계정: ${nickname.trim()}`);
                }
            } catch {
                // 무시
            }
        } else {
            console.log("❌ 세션 만료 또는 무효: 다시 로그인이 필요합니다.");
            console.log("   - NID 쿠키 존재 여부:", hasNidCookies);
            console.log("   - 로그인 버튼 발견:", !!loginButton);
            console.log("");
            console.log("💡 해결 방법: 'npm run cafe:login' 또는 'npm run login'을 실행하여 세션을 갱신하세요.");
        }

    } catch (error: any) {
        console.error(`⚠️ 검사 중 오류 발생: ${error.message}`);
    } finally {
        await browser.close();
        await prisma.$disconnect();
    }
}

main().catch(console.error);
