import cron from "node-cron";
import { config } from "./config.js";
import { refreshNewsFromProvider } from "./newsService.js";

let running = false;

async function safeRefresh(trigger) {
  if (running) {
    console.warn(`[news-refresh] skipped (${trigger}) because a run is already in progress`);
    return;
  }

  running = true;

  try {
    const result = await refreshNewsFromProvider();
    console.info(
      `[news-refresh] ${trigger} completed edition=${result.editionDate} inserted=${result.inserted} attempted=${result.totalAttempted}`
    );
  } catch (err) {
    console.error(`[news-refresh] ${trigger} failed:`, err.message);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const task = cron.schedule(config.cronSchedule, () => {
    void safeRefresh("cron");
  });

  if (config.autoRefreshOnStart) {
    void safeRefresh("startup");
  }

  return {
    stop: () => task.stop(),
    triggerNow: () => safeRefresh("manual")
  };
}
