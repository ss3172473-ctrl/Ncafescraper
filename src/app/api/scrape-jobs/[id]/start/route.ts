import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { spawn } from "child_process";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const { id } = await params;

  const job = await prisma.scrapeJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json(
      { success: false, error: "작업을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  if (job.status === "RUNNING") {
    return NextResponse.json(
      { success: false, error: "이미 실행 중인 작업입니다." },
      { status: 409 }
    );
  }

  const scriptPath = path.join(process.cwd(), "scripts", "scrape-job.ts");
  const child = spawn(
    "npx",
    ["ts-node", "--project", "tsconfig.scripts.json", scriptPath, id],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      shell: true,
    }
  );

  child.unref();

  return NextResponse.json({
    success: true,
    message: "작업 실행을 시작했습니다.",
  });
}
