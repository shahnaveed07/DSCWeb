import { CATEGORY_DEFINITIONS, config } from "./config.js";
import {
  getLatestEditionDate,
  getRowsByEditionDate,
  listEditionDates,
  saveNewsBatch
} from "./newsRepository.js";
import { fetchCategoryNews, toDbRows } from "./newsProvider.js";

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function buildCategoryPayload(rows) {
  const map = new Map();

  CATEGORY_DEFINITIONS.forEach((category) => {
    map.set(category.id, {
      id: category.id,
      name: category.name,
      items: []
    });
  });

  rows.forEach((row) => {
    if (!map.has(row.category_id)) {
      map.set(row.category_id, {
        id: row.category_id,
        name: row.category_name,
        items: []
      });
    }

    map.get(row.category_id).items.push({
      title: row.title,
      summary: row.summary,
      date: row.edition_date,
      source: row.source_name,
      url: row.article_url
    });
  });

  return Array.from(map.values());
}

export async function refreshNewsFromProvider() {
  const now = new Date();
  const rowsToPersist = [];

  for (const category of CATEGORY_DEFINITIONS) {
    const articles = await fetchCategoryNews(category);
    const rows = toDbRows(category, articles, now);
    rowsToPersist.push(...rows);
  }

  const result = saveNewsBatch(rowsToPersist);

  return {
    editionDate: toIsoDate(now),
    inserted: result.inserted,
    totalAttempted: rowsToPersist.length
  };
}

export function getNewsPayload(requestedDate) {
  const normalizedDate = normalizeDate(requestedDate);
  const latestEditionDate = getLatestEditionDate();
  const targetEditionDate = normalizedDate || latestEditionDate;

  if (!targetEditionDate) {
    return {
      version: "1.0.0",
      editionDate: null,
      updatedAt: new Date().toISOString(),
      meta: {
        title: "Daily World Updates | Dark Skull Corporation",
        description:
          "Daily World Updates covering top headlines from India, world affairs, technology, business, science, sports, entertainment, weather, and more.",
        canonical: config.canonicalNewsUrl,
        image: config.ogImage
      },
      archiveDates: [],
      categories: CATEGORY_DEFINITIONS.map((category) => ({
        id: category.id,
        name: category.name,
        items: []
      }))
    };
  }

  const rows = getRowsByEditionDate(targetEditionDate);
  const archiveDates = listEditionDates(60);
  const categories = buildCategoryPayload(rows);

  return {
    version: "1.0.0",
    editionDate: targetEditionDate,
    updatedAt: new Date().toISOString(),
    meta: {
      title: "Daily World Updates | Dark Skull Corporation",
      description:
        "Daily World Updates covering top headlines from India, world affairs, technology, business, science, sports, entertainment, weather, and more.",
      canonical: config.canonicalNewsUrl,
      image: config.ogImage
    },
    archiveDates,
    categories
  };
}
