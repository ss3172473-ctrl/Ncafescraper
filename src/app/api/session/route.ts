import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getCafeSessionStatus, NAVER_CAFE_SESSION_FILE } from "@/lib/naver/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  try {
    const session = getCafeSessionStatus();

    return NextResponse.json({
      success: true,
      data: {
        hasSession: session.hasSession,
        isValid: session.isValid,
        lastChecked: session.lastChecked?.toISOString(),
        sessionPath: NAVER_CAFE_SESSION_FILE,
      },
    });
  } catch (error) {
    console.error("세션 조회 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "세션 조회 실패",
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "터미널에서 `npm run cafe:login` 명령으로 네이버 카페 세션을 갱신하세요.",
    instructions: [
      "1. 터미널에서 `npm run cafe:login` 실행",
      "2. 브라우저에서 네이버 로그인 완료",
      "3. 세션 저장 후 대시보드 새로고침",
    ],
  });
}
