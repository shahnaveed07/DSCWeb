import express from "express";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { getNewsPayload, refreshNewsFromProvider } from "./newsService.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "dscweb-news-backend",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/news", (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : null;
    const payload = getNewsPayload(date);
    res.setHeader("Cache-Control", "no-store");
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: "Failed to retrieve news payload",
      message: err.message
    });
  }
});

app.post("/api/news/refresh", async (_req, res) => {
  try {
    const result = await refreshNewsFromProvider();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to refresh news",
      message: err.message
    });
  }
});

const refreshOnly = process.argv.includes("--refresh-only");

if (refreshOnly) {
  refreshNewsFromProvider()
    .then((result) => {
      console.info("refresh-only complete", result);
      closeDb();
      process.exit(0);
    })
    .catch((err) => {
      console.error("refresh-only failed", err.message);
      closeDb();
      process.exit(1);
    });
} else {
  const scheduler = startScheduler();
  const server = app.listen(config.port, () => {
    console.info(`news backend listening on http://localhost:${config.port}`);
  });

  function shutdown() {
    scheduler.stop();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
