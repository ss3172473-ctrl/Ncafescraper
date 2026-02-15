import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasDatabaseUrlUnderscore = !!process.env.DATABASE_URL_;
  const hasAuthSecret = !!process.env.APP_AUTH_SECRET;

  return NextResponse.json({
    success: true,
    data: {
      hasDatabaseUrl,
      hasDatabaseUrlUnderscore,
      hasAuthSecret,
      // Helps confirm which deployment this is, even when DB is broken.
      sha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null,
      vercelUrl: process.env.VERCEL_URL || null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    },
  });
}

