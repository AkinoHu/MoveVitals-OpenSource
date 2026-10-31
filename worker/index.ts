// Background worker: periodic incremental sync + webhook queue retries.
// Runs as a separate Railway service: `pnpm worker`.
import { migrate } from "../src/lib/db";
import { backupDue, runBackup } from "../src/lib/backup";
import { housekeepingDue, runHousekeeping } from "../src/lib/housekeeping";
import { processWebhooks, remapSports, syncDue } from "../src/lib/sync";

const SYNC_INTERVAL_MIN = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);
const TICK_MS = 60_000;

async function tick() {
  try {
    const hooks = await processWebhooks();
    const synced = await syncDue(SYNC_INTERVAL_MIN);
    if (hooks || synced) console.log(`[worker] webhooks=${hooks} synced=${synced}`);
    if (housekeepingDue()) {
      const swept = await runHousekeeping();
      const total = Object.values(swept).reduce((a, b) => a + b, 0);
      if (total) console.log(`[worker] housekeeping removed ${total} rows`, swept);
    }
    if (await backupDue()) {
      const r = await runBackup();
      console.log(r.ok ? `[worker] backup ${r.id} ok` : `[worker] backup failed: ${r.error}`);
    }
  } catch (e) {
    console.error("[worker] tick failed", e);
  }
}

async function main() {
  await migrate();
  const remapped = await remapSports().catch((e) => (console.error("[worker] remapSports", e), 0));
  if (remapped) console.log(`[worker] re-mapped sport for ${remapped} activities`);
  console.log(`[worker] started, sync interval ${SYNC_INTERVAL_MIN} min`);
  let stopping = false;
  const stop = () => (stopping = true);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
  process.exit(0);
}

main();
