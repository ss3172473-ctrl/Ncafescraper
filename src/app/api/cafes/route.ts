import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchJoinedCafes } from "@/lib/naver/cafes";
import { getCafeSessionStatus, NAVER_CAFE_SESSION_FILE } from "@/lib/naver/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const status = getCafeSessionStatus();
  if (!status.hasSession) {
    return NextResponse.json(
      {
        success: false,
        error: "카페 세션이 없습니다. 먼저 `npm run cafe:login`을 실행하세요.",
        data: {
          hasSession: false,
          sessionPath: NAVER_CAFE_SESSION_FILE,
        },
      },
      { status: 400 }
    );
  }

  try {
    const cafes = await fetchJoinedCafes();
    return NextResponse.json({ success: true, data: cafes });
  } catch (error) {
    console.error("가입 카페 조회 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "가입 카페 조회 실패",
      },
      { status: 500 }
    );
  }
}
