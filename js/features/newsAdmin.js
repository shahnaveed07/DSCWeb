(function () {
  "use strict";

  if (typeof window.DSCCore === "undefined") return;

  const Core = window.DSCCore;
  const state = {
    items: [],
    filtered: [],
    category: "",
    search: ""
  };

  const NEWS_ENDPOINT = "/api/news";

  const DOM = {
    addBtn: document.getElementById("newsAddBtn"),
    refreshBtn: document.getElementById("newsRefreshBtn"),
    search: document.getElementById("newsSearchInput"),
    categoryFilter: document.getElementById("newsCategoryFilter"),
    tableHead: document.getElementById("newsTableHead"),
    tableBody: document.getElementById("newsTableBody"),
    editModal: document.getElementById("newsEditModal"),
    editTitle: document.getElementById("newsEditTitle"),
    closeEdit: document.getElementById("closeNewsEdit"),
    form: document.getElementById("newsEditForm"),
    id: document.getElementById("newsId"),
    category: document.getElementById("newsCategory"),
    title: document.getElementById("newsTitle"),
    summary: document.getElementById("newsSummary"),
    imageUrl: document.getElementById("newsImageUrl"),
    sourceName: document.getElementById("newsSourceName"),
    sourceUrl: document.getElementById("newsSourceUrl"),
    author: document.getElementById("newsAuthor"),
    publishedAt: document.getElementById("newsPublishedAt"),
    languageCode: document.getElementById("newsLanguageCode"),
    tags: document.getElementById("newsTags"),
    isFeatured: document.getElementById("newsIsFeatured"),
    isActive: document.getElementById("newsIsActive"),
    datalist: document.getElementById("newsCategoryOptions")
  };

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function toDatetimeLocalValue(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function toIsoFromDatetimeLocal(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
  }

  function getCategoryList(items) {
    return Array.from(
      new Set(items.map((item) => normalizeText(item.category)).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));
  }

  function applyFilters() {
    const search = state.search.toLowerCase();
    state.filtered = state.items.filter((item) => {
      const matchesCategory = !state.category || item.category === state.category;
      const matchesSearch =
        !search ||
        [item.title, item.category, item.author]
          .join(" ")
          .toLowerCase()
          .includes(search);
      return matchesCategory && matchesSearch;
    });
    renderTable();
  }

  function renderTable() {
    if (!DOM.tableHead || !DOM.tableBody) return;

    DOM.tableHead.innerHTML = `
      <tr>
        <th>Title</th>
        <th>Category</th>
        <th>Author</th>
        <th>Status</th>
        <th>Featured</th>
        <th>Publish Date</th>
        <th>Actions</th>
      </tr>
    `;

    if (!state.filtered.length) {
      DOM.tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-warning">No news items found.</td></tr>';
      return;
    }

    DOM.tableBody.innerHTML = "";
    const fragment = document.createDocumentFragment();

    state.filtered.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${Core.escapeHTML(item.title || "-")}</td>
        <td>${Core.escapeHTML(item.category || "-")}</td>
        <td>${Core.escapeHTML(item.author || "-")}</td>
        <td>${item.isActive ? '<span class="badge good">Active</span>' : '<span class="badge bad">Inactive</span>'}</td>
        <td>${item.isFeatured ? '<span class="badge warning">Featured</span>' : '<span class="badge">No</span>'}</td>
        <td>${Core.escapeHTML(formatDate(item.publishedAt))}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn btn-neutral news-edit-btn">Edit</button>
            <button type="button" class="btn btn-outline news-feature-btn">${item.isFeatured ? "Unfeature" : "Feature"}</button>
            <button type="button" class="btn btn-danger news-delete-btn">Delete</button>
          </div>
        </td>
      `;

      row.querySelector(".news-edit-btn")?.addEventListener("click", () => openForm(item));
      row.querySelector(".news-feature-btn")?.addEventListener("click", () => toggleFeature(item));
      row.querySelector(".news-delete-btn")?.addEventListener("click", () => confirmDelete(item));
      fragment.appendChild(row);
    });

    DOM.tableBody.appendChild(fragment);
  }

  function syncCategoryUi(items) {
    if (DOM.categoryFilter) {
      const categories = getCategoryList(items);
      const currentValue = DOM.categoryFilter.value;
      DOM.categoryFilter.innerHTML = '<option value="">All Categories</option>';
      categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        DOM.categoryFilter.appendChild(option);
      });
      DOM.categoryFilter.value = categories.includes(currentValue) ? currentValue : "";
    }

    if (DOM.datalist) {
      DOM.datalist.innerHTML = "";
      getCategoryList(items).forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        DOM.datalist.appendChild(option);
      });
    }
  }

  async function loadNews() {
    Core.showLoader("Loading news...");
    try {
      const result = await Core.requestJson(NEWS_ENDPOINT, {
        method: "GET",
        headers: Core.getAuthHeader(),
        retries: 0
      });

      Core.hideLoader();
      if (Core.handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        Core.showMessage(Core.extractErrorMessage(result.data, "Failed to load news items."), "error");
        return;
      }

      const items = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.data?.items)
          ? result.data.items
          : Array.isArray(result.data?.categories)
            ? result.data.categories.flatMap((category) =>
                (category.items || []).map((item) => ({
                  ...item,
                  category: category.name || item.category
                }))
              )
            : [];

      state.items = items.map((item) => ({
        id: item.id ?? item.Id ?? 0,
        category: normalizeText(item.category || item.Category),
        title: normalizeText(item.title || item.Title),
        summary: normalizeText(item.summary || item.Summary),
        imageUrl: normalizeText(item.imageUrl || item.ImageUrl),
        sourceName: normalizeText(item.sourceName || item.SourceName),
        sourceUrl: normalizeText(item.sourceUrl || item.SourceUrl),
        author: normalizeText(item.author || item.Author),
        publishedAt: item.publishedAt || item.PublishedAt || null,
        createdAt: item.createdAt || item.CreatedAt || null,
        isFeatured: Boolean(item.isFeatured ?? item.IsFeatured),
        isActive: Boolean(item.isActive ?? item.IsActive ?? true),
        languageCode: normalizeText(item.languageCode || item.LanguageCode || "en"),
        tags: Array.isArray(item.tags || item.Tags) ? (item.tags || item.Tags).join(", ") : normalizeText(item.tags || item.Tags)
      }));

      syncCategoryUi(state.items);
      applyFilters();
    } catch (err) {
      Core.hideLoader();
      Core.showMessage("Server error while loading news.", "error");
    }
  }

  function resetForm() {
    DOM.id.value = "";
    DOM.category.value = "";
    DOM.title.value = "";
    DOM.summary.value = "";
    DOM.imageUrl.value = "";
    DOM.sourceName.value = "";
    DOM.sourceUrl.value = "";
    DOM.author.value = "";
    DOM.publishedAt.value = "";
    DOM.languageCode.value = "en";
    DOM.tags.value = "";
    DOM.isFeatured.checked = false;
    DOM.isActive.checked = true;
  }

  function openForm(item = null) {
    resetForm();
    if (item) {
      DOM.editTitle.textContent = "Edit News";
      DOM.id.value = String(item.id || "");
      DOM.category.value = item.category || "";
      DOM.title.value = item.title || "";
      DOM.summary.value = item.summary || "";
      DOM.imageUrl.value = item.imageUrl || "";
      DOM.sourceName.value = item.sourceName || "";
      DOM.sourceUrl.value = item.sourceUrl || "";
      DOM.author.value = item.author || "";
      DOM.publishedAt.value = toDatetimeLocalValue(item.publishedAt);
      DOM.languageCode.value = item.languageCode || "en";
      DOM.tags.value = item.tags || "";
      DOM.isFeatured.checked = Boolean(item.isFeatured);
      DOM.isActive.checked = Boolean(item.isActive);
    } else {
      DOM.editTitle.textContent = "Add News";
      DOM.publishedAt.value = toDatetimeLocalValue(new Date().toISOString());
    }

    Core.openModal("newsEditModal");
  }

  async function saveNews(event) {
    event.preventDefault();

    const payload = {
      category: normalizeText(DOM.category.value),
      title: normalizeText(DOM.title.value),
      summary: normalizeText(DOM.summary.value),
      imageUrl: normalizeText(DOM.imageUrl.value),
      sourceName: normalizeText(DOM.sourceName.value),
      sourceUrl: normalizeText(DOM.sourceUrl.value),
      author: normalizeText(DOM.author.value),
      publishedAt: toIsoFromDatetimeLocal(DOM.publishedAt.value),
      isFeatured: DOM.isFeatured.checked,
      isActive: DOM.isActive.checked,
      languageCode: normalizeText(DOM.languageCode.value || "en"),
      tags: normalizeText(DOM.tags.value)
    };

    if (!payload.category || !payload.title || !payload.summary) {
      Core.showMessage("Category, title, and summary are required.", "error");
      return;
    }

    Core.showLoader("Saving news...");
    try {
      const isEdit = Boolean(DOM.id.value);
      const endpoint = isEdit ? `${NEWS_ENDPOINT}/${encodeURIComponent(DOM.id.value)}` : NEWS_ENDPOINT;
      const method = isEdit ? "PUT" : "POST";

      const result = await Core.requestJson(endpoint, {
        method,
        headers: Core.getAuthHeader(),
        body: payload
      });

      Core.hideLoader();
      if (Core.handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        Core.showMessage(Core.extractErrorMessage(result.data, "Failed to save news."), "error");
        return;
      }

      Core.closeModal("newsEditModal");
      Core.showMessage(isEdit ? "News updated successfully." : "News published successfully.", "success");
      await loadNews();
    } catch (err) {
      Core.hideLoader();
      Core.showMessage("Server error while saving news.", "error");
    }
  }

  function confirmDelete(item) {
    Core.openDeleteConfirmation(`News: ${item.title || "Untitled"}`, async () => {
      if (!item.id) return;

      Core.showLoader("Deleting news...");
      try {
        const result = await Core.requestJson(`${NEWS_ENDPOINT}/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
          headers: Core.getAuthHeader()
        });

        Core.hideLoader();
        if (Core.handleAdminAuthFailure(result.status)) return;
        if (!result.ok) {
          Core.showMessage(Core.extractErrorMessage(result.data, "Failed to delete news."), "error");
          return;
        }

        Core.showMessage("News deleted successfully.", "success");
        await loadNews();
      } catch (err) {
        Core.hideLoader();
        Core.showMessage("Server error while deleting news.", "error");
      }
    });
  }

  async function toggleFeature(item) {
    Core.showLoader("Updating feature status...");
    try {
      const result = await Core.requestJson(`${NEWS_ENDPOINT}/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: Core.getAuthHeader(),
        body: {
          ...item,
          isFeatured: !item.isFeatured
        }
      });

      Core.hideLoader();
      if (Core.handleAdminAuthFailure(result.status)) return;
      if (!result.ok) {
        Core.showMessage(Core.extractErrorMessage(result.data, "Failed to update feature status."), "error");
        return;
      }

      Core.showMessage("Feature status updated.", "success");
      await loadNews();
    } catch (err) {
      Core.hideLoader();
      Core.showMessage("Server error while updating feature status.", "error");
    }
  }

  function bind() {
    DOM.addBtn?.addEventListener("click", () => openForm());
    DOM.refreshBtn?.addEventListener("click", () => loadNews());
    DOM.search?.addEventListener("input", (event) => {
      state.search = event.target.value || "";
      applyFilters();
    });
    DOM.categoryFilter?.addEventListener("change", (event) => {
      state.category = event.target.value || "";
      applyFilters();
    });
    DOM.closeEdit?.addEventListener("click", () => Core.closeModal("newsEditModal"));
    DOM.form?.addEventListener("submit", saveNews);
  }

  bind();
  window.__NEWS_ADMIN_BOOTSTRAP__ = function () {
    return loadNews();
  };
  window.addEventListener("DOMContentLoaded", () => {
    if (DOM.tableBody) loadNews();
  });
})();