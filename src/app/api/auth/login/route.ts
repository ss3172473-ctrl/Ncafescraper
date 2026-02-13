import { NextRequest, NextResponse } from "next/server";
import { createAuthToken, validateAppCredential } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "아이디와 비밀번호를 입력하세요." },
        { status: 400 }
      );
    }

    const isValid = validateAppCredential(username, password);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "인증 정보가 올바르지 않습니다." },
        { status: 401 }
      );
    }

    const token = createAuthToken(username);
    const response = NextResponse.json({ success: true, data: { username } });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });

    return response;
  } catch (error) {
    console.error("로그인 실패:", error);
    return NextResponse.json(
      { success: false, error: "로그인 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
