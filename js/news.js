(function () {
  "use strict";

  const CATEGORY_ORDER = [
    "Top Headlines",
    "India",
    "World",
    "Technology",
    "Artificial Intelligence",
    "Android",
    "Apple",
    "Gaming",
    "Business",
    "Finance",
    "Crypto",
    "Automobile",
    "Science",
    "Space",
    "Cyber Security",
    "Sports",
    "Entertainment",
    "Movies & OTT",
    "Weather",
    "Today's Fact",
    "Quote of the Day"
  ];

  const DOM = {
    title: document.getElementById("news-page-title"),
    metaDescription: document.getElementById("meta-description"),
    canonical: document.getElementById("canonical-link"),
    ogTitle: document.getElementById("og-title"),
    ogDescription: document.getElementById("og-description"),
    ogUrl: document.getElementById("og-url"),
    ogImage: document.getElementById("og-image"),
    twitterTitle: document.getElementById("twitter-title"),
    twitterDescription: document.getElementById("twitter-description"),
    twitterImage: document.getElementById("twitter-image"),
    articleSchema: document.getElementById("article-schema"),
    newsArticleSchema: document.getElementById("news-article-schema"),
    mainTitle: document.getElementById("news-main-title"),
    mainDescription: document.getElementById("news-main-description"),
    editionLabel: document.getElementById("edition-label"),
    editionUpdated: document.getElementById("edition-updated"),
    status: document.getElementById("news-load-status"),
    archiveForm: document.getElementById("archive-form"),
    archiveDateInput: document.getElementById("archive-date"),
    loadLatestBtn: document.getElementById("load-latest-btn"),
    archiveDateList: document.getElementById("archive-date-list"),
    archivePanel: document.getElementById("archive-panel"),
    categoryContainer: document.getElementById("news-category-container")
  };

  let observer = null;
  let currentPayload = null;
  let currentSource = "latest";
  const API_BASE = "";

  function normalizeDate(dateString) {
    const value = String(dateString || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    return value;
  }

  function toDisplayDate(dateString) {
    const normalized = normalizeDate(dateString);
    if (!normalized) return "Unknown date";
    const dateObj = new Date(`${normalized}T00:00:00Z`);
    return dateObj.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "2-digit",
      timeZone: "UTC"
    });
  }

  function toDisplayDateTime(isoString) {
    if (!isoString) return "Unknown";
    const dateObj = new Date(isoString);
    if (Number.isNaN(dateObj.getTime())) return "Unknown";
    return dateObj.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  async function fetchJson(pathWithQuery) {
    const response = await fetch(`${API_BASE}${pathWithQuery}`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Request failed (${response.status}): ${payload.slice(0, 200)}`);
    }

    return response.json();
  }

  const CATEGORY_ORDER_MAP = new Map(
    CATEGORY_ORDER.map((name, index) => [name.toLowerCase(), index])
  );

  function sortCategories(categories) {
    const list = Array.isArray(categories) ? categories.slice() : [];

    return list.sort((a, b) => {
      const aName = String(a && a.name ? a.name : "").toLowerCase();
      const bName = String(b && b.name ? b.name : "").toLowerCase();
      const aIndex = CATEGORY_ORDER_MAP.has(aName) ? CATEGORY_ORDER_MAP.get(aName) : Number.MAX_SAFE_INTEGER;
      const bIndex = CATEGORY_ORDER_MAP.has(bName) ? CATEGORY_ORDER_MAP.get(bName) : Number.MAX_SAFE_INTEGER;

      if (aIndex !== bIndex) return aIndex - bIndex;
      return aName.localeCompare(bName);
    });
  }

  function normalizeApiItem(item) {
    if (!item || typeof item !== "object") {
      return {
        category: "Uncategorized",
        title: "Untitled",
        summary: "No summary available.",
        date: ""
      };
    }

    const category = String(item.Category || item.category || "").trim();
    const title = String(item.Title || item.title || "").trim();
    const summary = String(item.Summary || item.summary || "").trim();
    const date = String(item.PublishedAt || item.publishedAt || item.CreatedAt || item.createdAt || "").trim();

    return {
      category,
      title,
      summary,
      date: date ? date.slice(0, 10) : ""
    };
  }

  function groupFlatItems(items) {
    const grouped = new Map();

    CATEGORY_ORDER.forEach((name) => {
      grouped.set(name, { id: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""), name, items: [] });
    });

    items.forEach((item) => {
      const categoryName = item.category || "Uncategorized";
      if (!grouped.has(categoryName)) {
        grouped.set(categoryName, { id: categoryName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""), name: categoryName, items: [] });
      }

      grouped.get(categoryName).items.push({
        title: item.title,
        summary: item.summary,
        date: item.date || new Date().toISOString().slice(0, 10)
      });
    });

    return sortCategories(Array.from(grouped.values()));
  }

  function extractFlatItems(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.items)) {
      return payload.items;
    }

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    if (Array.isArray(payload?.news)) {
      return payload.news;
    }

    return [];
  }

  function clearObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function createNewsCard(item) {
    const article = document.createElement("article");
    article.className = "feature-card news-item-card";

    const title = document.createElement("h3");
    title.textContent = item.title || "Untitled";

    const summary = document.createElement("p");
    summary.textContent = item.summary || "No summary available.";

    const date = document.createElement("p");
    date.className = "news-item-date";
    date.textContent = `Date: ${toDisplayDate(item.date)}`;

    article.appendChild(title);
    article.appendChild(summary);
    article.appendChild(date);

    return article;
  }

  function renderCategoryContent(target, category) {
    const items = Array.isArray(category.items) ? category.items : [];

    target.innerHTML = "";

    if (!items.length) {
      const emptyText = document.createElement("p");
      emptyText.className = "muted mb-0";
      emptyText.textContent = "No updates available in this category.";
      target.appendChild(emptyText);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "section-grid";

    items.forEach((item) => {
      grid.appendChild(createNewsCard(item));
    });

    target.appendChild(grid);
  }

  function mountCategoryShells(categories) {
    clearObserver();
    DOM.categoryContainer.innerHTML = "";

    const sorted = sortCategories(categories);

    sorted.forEach((category) => {
      const section = document.createElement("section");
      section.className = "news-category-block";
      section.dataset.categoryId = category.id || "";

      const header = document.createElement("div");
      header.className = "panel-header";

      const heading = document.createElement("h3");
      heading.textContent = category.name || "Uncategorized";

      header.appendChild(heading);

      const body = document.createElement("div");
      body.className = "news-category-body";
      body.innerHTML = "<div class=\"news-skeleton\"></div>";

      section.appendChild(header);
      section.appendChild(body);
      DOM.categoryContainer.appendChild(section);

      section.__categoryData = category;
      section.__bodyRef = body;
    });

    if (!sorted.length) {
      DOM.categoryContainer.innerHTML = "<p class=\"muted\">No categories found in this news edition.</p>";
      return;
    }

    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const section = entry.target;
          const category = section.__categoryData;
          const body = section.__bodyRef;

          if (category && body && !section.dataset.rendered) {
            renderCategoryContent(body, category);
            section.dataset.rendered = "true";
          }

          observer.unobserve(section);
        });
      },
      {
        root: null,
        rootMargin: "220px 0px",
        threshold: 0.01
      }
    );

    DOM.categoryContainer.querySelectorAll(".news-category-block").forEach((section) => {
      observer.observe(section);
    });
  }

  function setArchiveVisibility(isAvailable) {
    if (!DOM.archivePanel) return;
    DOM.archivePanel.classList.toggle("d-none", !isAvailable);
  }

  function updateSeo(payload, sourcePath) {
    const meta = payload.meta || {};
    const title = meta.title || "Daily World Updates | Dark Skull Corporation";
    const description =
      meta.description ||
      "Daily World Updates covering top headlines from India, world affairs, technology, business, science, sports, entertainment, weather, and more.";
    const canonical = meta.canonical || "https://dscweb.me/pages/news.html";
    const image = meta.image || "https://dscweb.me/images/dsclogo.png";
    const editionDate = normalizeDate(payload.editionDate) || new Date().toISOString().slice(0, 10);

    const flatItems = extractFlatItems(payload).map(normalizeApiItem);
    const topItem = flatItems[0] || null;

    document.title = title;
    DOM.title.textContent = title;
    DOM.metaDescription.setAttribute("content", description);
    DOM.canonical.setAttribute("href", canonical);

    DOM.ogTitle.setAttribute("content", title);
    DOM.ogDescription.setAttribute("content", description);
    DOM.ogUrl.setAttribute("content", canonical);
    DOM.ogImage.setAttribute("content", image);

    DOM.twitterTitle.setAttribute("content", title);
    DOM.twitterDescription.setAttribute("content", description);
    DOM.twitterImage.setAttribute("content", image);

    DOM.articleSchema.textContent = JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        datePublished: editionDate,
        dateModified: editionDate,
        author: {
          "@type": "Organization",
          name: "Dark Skull Corporation"
        },
        publisher: {
          "@type": "Organization",
          name: "Dark Skull Corporation",
          logo: {
            "@type": "ImageObject",
            url: "https://dscweb.me/images/dsclogo.png"
          }
        },
        mainEntityOfPage: canonical
      },
      null,
      2
    );

    DOM.newsArticleSchema.textContent = JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: topItem && topItem.title ? topItem.title : title,
        description: topItem && topItem.summary ? topItem.summary : description,
        datePublished: editionDate,
        dateModified: editionDate,
        author: {
          "@type": "Organization",
          name: "Dark Skull Corporation"
        },
        publisher: {
          "@type": "Organization",
          name: "Dark Skull Corporation",
          logo: {
            "@type": "ImageObject",
            url: "https://dscweb.me/images/dsclogo.png"
          }
        },
        mainEntityOfPage: canonical,
        articleSection: "Daily World Updates",
        url: sourcePath
      },
      null,
      2
    );
  }

  function updatePageHeader(payload, sourceLabel) {
    const editionDate = normalizeDate(payload.editionDate);
    const displayEdition = editionDate ? toDisplayDate(editionDate) : "Unknown edition";
    const updated = toDisplayDateTime(payload.updatedAt);

    DOM.mainTitle.textContent = payload.meta && payload.meta.title ? payload.meta.title : "Daily World Updates";
    DOM.mainDescription.textContent =
      payload.meta && payload.meta.description
        ? payload.meta.description
        : "Daily updates across key categories.";

    DOM.editionLabel.textContent = `${sourceLabel} Edition: ${displayEdition}`;
    DOM.editionUpdated.textContent = `Last updated: ${updated}`;
    DOM.status.textContent = `Loaded ${sourceLabel.toLowerCase()} feed successfully.`;
  }

  function parseArchiveDates(payload) {
    const fromPayload = Array.isArray(payload.archiveDates) ? payload.archiveDates : [];
    return fromPayload
      .map(normalizeDate)
      .filter(Boolean)
      .sort((a, b) => (a > b ? -1 : 1));
  }

  function renderArchiveDateButtons(dateList) {
    DOM.archiveDateList.innerHTML = "";

    if (!dateList.length) {
      DOM.archiveDateList.innerHTML = "<p class=\"muted mb-0\">No archive dates listed yet.</p>";
      return;
    }

    dateList.forEach((dateValue) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-outline news-archive-date-btn";
      button.dataset.date = dateValue;
      button.textContent = dateValue;

      button.addEventListener("click", () => {
        DOM.archiveDateInput.value = dateValue;
        void loadArchive(dateValue);
      });

      DOM.archiveDateList.appendChild(button);
    });
  }

  function hideArchiveControls() {
    if (DOM.archiveForm) DOM.archiveForm.classList.add("d-none");
    if (DOM.archiveDateList) DOM.archiveDateList.innerHTML = '<p class="muted mb-0">Archive controls are unavailable for this API.</p>';
    if (DOM.loadLatestBtn) DOM.loadLatestBtn.textContent = "Reload Latest";
    // TODO: Re-enable archive browsing when the backend exposes archive endpoints or historical queries.
  }

  async function loadLatest() {
    currentSource = "latest";
    DOM.status.textContent = "Fetching /api/news";

    const payload = await fetchJson("/api/news");
    currentPayload = payload;

    updateSeo(payload, window.location.href);
    updatePageHeader(payload, "Latest");
    const flatItems = extractFlatItems(payload).map(normalizeApiItem);
    const groupedCategories = flatItems.length
      ? groupFlatItems(flatItems)
      : sortCategories(Array.isArray(payload.categories) ? payload.categories.map((category) => ({
          id: category.id || category.Category || category.name,
          name: category.name || category.Category || category.category || "Uncategorized",
          items: Array.isArray(category.items)
            ? category.items.map((item) => ({
                title: item.title || item.Title || "Untitled",
                summary: item.summary || item.Summary || "No summary available.",
                date: item.date || item.PublishedAt || item.publishedAt || payload.editionDate
              }))
            : []
        })) : []);
    mountCategoryShells(groupedCategories);

    const archiveDates = parseArchiveDates(payload);
    if (archiveDates.length) renderArchiveDateButtons(archiveDates);
    else hideArchiveControls();

    const today = normalizeDate(payload.editionDate);
    if (today) {
      DOM.archiveDateInput.value = today;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("date");
    window.history.replaceState({}, "", url.toString());
  }

  async function loadArchive(dateValue) {
    if (!DOM.archiveForm || DOM.archiveForm.classList.contains("d-none")) {
      DOM.status.textContent = "Archive browsing is unavailable for the current API.";
      return;
    }

    const normalizedDate = normalizeDate(dateValue);
    if (!normalizedDate) {
      DOM.status.textContent = "Please select a valid date (YYYY-MM-DD).";
      return;
    }

    currentSource = "archive";
    DOM.status.textContent = `Loading archive /api/news?date=${normalizedDate}`;

    const payload = await fetchJson(`/api/news?date=${encodeURIComponent(normalizedDate)}`);

    currentPayload = payload;

    updateSeo(payload, `${window.location.origin}/news/archive/${normalizedDate}.json`);
    updatePageHeader(payload, "Archive");
    mountCategoryShells(payload.categories);

    const url = new URL(window.location.href);
    url.searchParams.set("date", normalizedDate);
    window.history.replaceState({}, "", url.toString());

    DOM.status.textContent = `Loaded archive feed for ${normalizedDate}.`;
  }

  async function init() {
    if (!DOM.categoryContainer) return;

    DOM.archiveForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void loadArchive(DOM.archiveDateInput.value).catch((err) => {
        DOM.status.textContent = `Failed to load archive: ${err.message}`;
      });
    });

    DOM.loadLatestBtn.addEventListener("click", () => {
      void loadLatest().catch((err) => {
        DOM.status.textContent = `Failed to load latest feed: ${err.message}`;
      });
    });

    try {
      await loadLatest();

      const queryDate = new URL(window.location.href).searchParams.get("date");
      if (queryDate) {
        await loadArchive(queryDate);
      }
    } catch (err) {
      DOM.status.textContent = `Unable to load news feed: ${err.message}`;
      DOM.categoryContainer.innerHTML =
        "<div class=\"alert-box alert-danger\"><p class=\"mb-0\">News feed is currently unavailable. Please try again shortly.</p></div>";
      hideArchiveControls();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
