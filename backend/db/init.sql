CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_date TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_name TEXT,
  article_url TEXT NOT NULL,
  image_url TEXT,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(article_url, category_id, edition_date)
);

CREATE INDEX IF NOT EXISTS idx_news_edition_date ON news (edition_date);
CREATE INDEX IF NOT EXISTS idx_news_category ON news (category_id);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news (published_at DESC);
