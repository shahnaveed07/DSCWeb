import { config } from "./config.js";

function isoDateOnly(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function sanitizeSummary(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildGnewsUrl(category) {
  const params = new URLSearchParams({
    apikey: config.gnewsApiKey,
    lang: config.language,
    country: config.country,
    max: String(config.itemsPerCategory),
    q: category.query
  });

  return `${config.newsBaseUrl}/search?${params.toString()}`;
}

function normalizeArticle(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = String(raw.title || "").trim();
  const summary = sanitizeSummary(raw.description || raw.content || "");
  const articleUrl = String(raw.url || "").trim();

  if (!title || !summary || !articleUrl) {
    return null;
  }

  return {
    title,
    summary,
    articleUrl,
    sourceName: raw.source && raw.source.name ? String(raw.source.name).trim() : null,
    imageUrl: raw.image ? String(raw.image).trim() : null,
    publishedAt: raw.publishedAt ? new Date(raw.publishedAt).toISOString() : new Date().toISOString()
  };
}

export async function fetchCategoryNews(category) {
  if (!config.gnewsApiKey) {
    throw new Error("Missing GNEWS_API_KEY in server environment.");
  }

  if (config.provider !== "gnews") {
    throw new Error(`Unsupported NEWS_API_PROVIDER: ${config.provider}`);
  }

  const requestUrl = buildGnewsUrl(category);
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`GNews request failed (${response.status}): ${payload.slice(0, 220)}`);
  }

  const data = await response.json();
  const articles = Array.isArray(data.articles) ? data.articles : [];

  return articles.map(normalizeArticle).filter(Boolean);
}

export function toDbRows(category, articles, now = new Date()) {
  const editionDate = isoDateOnly(now);

  return articles.map((article) => ({
    edition_date: editionDate,
    category_id: category.id,
    category_name: category.name,
    title: article.title,
    summary: article.summary,
    source_name: article.sourceName,
    article_url: article.articleUrl,
    image_url: article.imageUrl,
    published_at: article.publishedAt
  }));
}
