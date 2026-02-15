
import pLimit from 'p-limit';

const limit = pLimit(5);

const runCandidate = async (id: number) => {
    console.log(`Starting task ${id}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`Finished task ${id}`);
};

async function main() {
    const tasks = Array.from({ length: 20 }, (_, k) => k + 1);
    console.log("Starting 20 tasks with concurrency 5...");
    const start = Date.now();
    await Promise.all(tasks.map(t => limit(() => runCandidate(t))));
    const end = Date.now();
    console.log(`All tasks finished in ${(end - start) / 1000} seconds`);
}

main();
