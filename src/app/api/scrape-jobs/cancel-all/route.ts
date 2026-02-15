import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
    const user = await getCurrentUser();
    if (!user) {
        return NextResponse.json(
            { success: false, error: "UNAUTHORIZED" },
            { status: 401 }
        );
    }

    // Find all active jobs (RUNNING or QUEUED)
    const activeJobs = await prisma.scrapeJob.findMany({
        where: { status: { in: ["RUNNING", "QUEUED"] } },
        select: { id: true, status: true },
    });

    if (activeJobs.length === 0) {
        return NextResponse.json({ success: true, cancelled: 0, message: "활성 작업이 없습니다." });
    }

    const now = new Date();
    const cancelledIds: string[] = [];

    for (const job of activeJobs) {
        // Update job status
        await prisma.scrapeJob.update({
            where: { id: job.id },
            data: {
                status: "CANCELLED",
                completedAt: now,
                errorMessage: job.status === "QUEUED" ? "cancelled by user (queued)" : "cancelled by user",
            },
        });

        // Set cancel flag for RUNNING jobs so worker stops gracefully
        if (job.status === "RUNNING") {
            const cancelKey = `scrapeJobCancel:${job.id}`;
            const progressKey = `scrapeJobProgress:${job.id}`;

            await prisma.setting.upsert({
                where: { key: cancelKey },
                create: { key: cancelKey, value: "true" },
                update: { value: "true" },
            });

            // Update progress to show cancelled
            const progress = await prisma.setting.findUnique({ where: { key: progressKey } }).catch(() => null);
            const previous = (() => {
                if (!progress?.value) return {};
                try {
                    const parsed = JSON.parse(progress.value);
                    if (parsed && typeof parsed === "object") return parsed;
                } catch { /* ignore */ }
                return {};
            })();
            await prisma.setting.upsert({
                where: { key: progressKey },
                create: { key: progressKey, value: JSON.stringify({ ...previous, stage: "CANCELLED", message: "cancel requested", updatedAt: now.toISOString() }) },
                update: { value: JSON.stringify({ ...previous, stage: "CANCELLED", message: "cancel requested", updatedAt: now.toISOString() }) },
            });
        } else {
            // Clean up progress/cancel keys for queued jobs
            await prisma.setting.deleteMany({
                where: { key: { in: [`scrapeJobProgress:${job.id}`, `scrapeJobCancel:${job.id}`] } },
            });
        }

        cancelledIds.push(job.id);
    }

    return NextResponse.json({
        success: true,
        cancelled: cancelledIds.length,
        message: `${cancelledIds.length}개 작업을 모두 중단했습니다.`,
    });
}
