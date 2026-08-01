import dotenv from "dotenv";

dotenv.config();

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: toInt(process.env.PORT, 8080),
  provider: String(process.env.NEWS_API_PROVIDER || "gnews").trim().toLowerCase(),
  gnewsApiKey: String(process.env.GNEWS_API_KEY || "").trim(),
  language: String(process.env.NEWS_LANGUAGE || "en").trim().toLowerCase(),
  country: String(process.env.NEWS_COUNTRY || "in").trim().toLowerCase(),
  itemsPerCategory: Math.min(Math.max(toInt(process.env.NEWS_ITEMS_PER_CATEGORY, 1), 1), 5),
  cronSchedule: String(process.env.NEWS_CRON || "15 * * * *").trim(),
  newsBaseUrl: String(process.env.NEWS_BASE_URL || "https://gnews.io/api/v4").trim().replace(/\/+$/, ""),
  canonicalNewsUrl: String(process.env.CANONICAL_NEWS_URL || "https://dscweb.me/pages/news.html").trim(),
  ogImage: String(process.env.NEWS_OG_IMAGE || "https://dscweb.me/images/dsclogo.png").trim(),
  autoRefreshOnStart: String(process.env.AUTO_REFRESH_ON_START || "true").trim().toLowerCase() === "true"
};

export const CATEGORY_DEFINITIONS = [
  { id: "top-headlines", name: "Top Headlines", topic: "nation", query: "latest headlines" },
  { id: "india", name: "India", topic: "nation", query: "india" },
  { id: "world", name: "World", topic: "world", query: "world" },
  { id: "technology", name: "Technology", topic: "technology", query: "technology" },
  { id: "artificial-intelligence", name: "Artificial Intelligence", topic: "technology", query: "artificial intelligence" },
  { id: "android", name: "Android", topic: "technology", query: "android" },
  { id: "apple", name: "Apple", topic: "technology", query: "apple" },
  { id: "gaming", name: "Gaming", topic: "technology", query: "gaming" },
  { id: "business", name: "Business", topic: "business", query: "business" },
  { id: "finance", name: "Finance", topic: "business", query: "finance" },
  { id: "crypto", name: "Crypto", topic: "business", query: "crypto" },
  { id: "automobile", name: "Automobile", topic: "nation", query: "automobile" },
  { id: "science", name: "Science", topic: "science", query: "science" },
  { id: "space", name: "Space", topic: "science", query: "space" },
  { id: "cyber-security", name: "Cyber Security", topic: "technology", query: "cyber security" },
  { id: "sports", name: "Sports", topic: "sports", query: "sports" },
  { id: "entertainment", name: "Entertainment", topic: "entertainment", query: "entertainment" },
  { id: "movies-ott", name: "Movies & OTT", topic: "entertainment", query: "movies ott" },
  { id: "weather", name: "Weather", topic: "nation", query: "weather" },
  { id: "todays-fact", name: "Today's Fact", topic: "science", query: "fact of the day" },
  { id: "quote-of-the-day", name: "Quote of the Day", topic: "world", query: "quote of the day" }
];
