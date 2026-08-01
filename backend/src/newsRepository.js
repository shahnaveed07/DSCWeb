import { getDb } from "./db.js";

const db = getDb();

const insertStatement = db.prepare(`
  INSERT OR IGNORE INTO news (
    edition_date,
    category_id,
    category_name,
    title,
    summary,
    source_name,
    article_url,
    image_url,
    published_at
  ) VALUES (
    @edition_date,
    @category_id,
    @category_name,
    @title,
    @summary,
    @source_name,
    @article_url,
    @image_url,
    @published_at
  )
`);

export function saveNewsBatch(rows) {
  if (!Array.isArray(rows) || !rows.length) return { inserted: 0 };

  const tx = db.transaction((payload) => {
    let inserted = 0;
    payload.forEach((row) => {
      const result = insertStatement.run(row);
      inserted += result.changes;
    });
    return { inserted };
  });

  return tx(rows);
}

export function listEditionDates(limit = 30) {
  return db
    .prepare(
      `
      SELECT edition_date
      FROM news
      GROUP BY edition_date
      ORDER BY edition_date DESC
      LIMIT ?
    `
    )
    .all(limit)
    .map((row) => row.edition_date);
}

export function getLatestEditionDate() {
  const row = db
    .prepare(
      `
      SELECT edition_date
      FROM news
      ORDER BY edition_date DESC
      LIMIT 1
    `
    )
    .get();

  return row ? row.edition_date : null;
}

export function getRowsByEditionDate(editionDate) {
  return db
    .prepare(
      `
      SELECT
        edition_date,
        category_id,
        category_name,
        title,
        summary,
        source_name,
        article_url,
        image_url,
        published_at,
        created_at
      FROM news
      WHERE edition_date = ?
      ORDER BY category_name ASC, published_at DESC
    `
    )
    .all(editionDate);
}
