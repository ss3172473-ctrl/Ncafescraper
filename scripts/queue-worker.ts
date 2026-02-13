import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import path from "path";

const prisma = new PrismaClient();

async function tick() {
  const running = await prisma.scrapeJob.count({ where: { status: "RUNNING" } });
  if (running > 0) return;

  const nextJob = await prisma.scrapeJob.findFirst({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });

  if (!nextJob) return;

  const scriptPath = path.join(process.cwd(), "scripts", "scrape-job.ts");
  const child = spawn(
    "npx",
    ["ts-node", "--project", "tsconfig.scripts.json", scriptPath, nextJob.id],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    }
  );

  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
  });
}

async function main() {
  console.log("queue worker started");
  while (true) {
    await tick().catch((error) => {
      console.error("worker tick error", error);
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().finally(async () => {
  await prisma.$disconnect();
});
