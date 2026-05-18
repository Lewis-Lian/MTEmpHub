(function () {
  const STORAGE_KEY = "attendance.appTabs.v1";
  const MAX_TABS = 10;
  const EMBED_PARAM = "__tab";
  const ELIGIBLE_PREFIXES = ["/employee/", "/admin/", "/module/"];
  const CANONICAL_PATHS = {
    "/module/home": "/employee/home",
  };

  function isEmbedded() {
    return document.body?.dataset.embeddedTab === "1" || window.top !== window;
  }

  function isEnabled() {
    return document.body?.dataset.tabEnabled === "1";
  }

  function normalizeUrl(input) {
    try {
      const url = new URL(input, window.location.origin);
      url.hash = "";
      url.searchParams.delete(EMBED_PARAM);
      url.pathname = CANONICAL_PATHS[url.pathname] || url.pathname;
      return `${url.pathname}${url.search}`;
    } catch (_) {
      return "";
    }
  }

  function buildFrameUrl(input) {
    const url = new URL(input, window.location.origin);
    url.searchParams.set(EMBED_PARAM, "1");
    return `${url.pathname}${url.search}`;
  }

  function isEligibleUrl(input) {
    const normalized = normalizeUrl(input);
    if (!normalized) return false;
    if (normalized === "/logout") return false;
    if (normalized.startsWith("/api/")) return false;
    return ELIGIBLE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { tabs: [], activeTabId: "" };
      const data = JSON.parse(raw);
      return {
        tabs: Array.isArray(data?.tabs) ? data.tabs : [],
        activeTabId: typeof data?.activeTabId === "string" ? data.activeTabId : "",
      };
    } catch (_) {
      return { tabs: [], activeTabId: "" };
    }
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        url: tab.url,
        title: tab.title,
        moduleSlug: tab.moduleSlug || "",
        createdAt: tab.createdAt || Date.now(),
      })),
      activeTabId: state.activeTabId,
    }));
  }

  function makeTabId(url) {
    const safe = normalizeUrl(url).replace(/[^a-zA-Z0-9_-]/g, "_");
    return `tab_${safe || Date.now()}`;
  }

  function titleFromLink(link) {
    return (link?.dataset?.tabTitle || link?.getAttribute("title") || link?.textContent || "").trim();
  }

  function shouldHandleLink(anchor, event) {
    if (!anchor) return false;
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.hasAttribute("download")) return false;
    if ((anchor.getAttribute("target") || "").trim() === "_blank") return false;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return false;
    return isEligibleUrl(anchor.href || href);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!isEnabled() || isEmbedded()) return;

    const tabBarEl = document.getElementById("appTabBar");
    const tabListEl = document.getElementById("appTabList");
    const framesEl = document.getElementById("appTabFrames");
    const initialPaneEl = document.getElementById("appTabInitialPane");
    if (!tabBarEl || !tabListEl || !framesEl || !initialPaneEl) return;

    const currentUrl = normalizeUrl(document.body.dataset.tabCurrentUrl || window.location.pathname);
    const currentTitle = (document.body.dataset.tabCurrentTitle || document.title || "未命名页面").trim();
    const currentModuleSlug = document.body.dataset.tabModuleSlug || "";
    const state = readState();

    function showToast(message) {
      if (window.AppToast?.warning) window.AppToast.warning(message, "提示");
    }

    function dedupeTabs(tabs) {
      const seen = new Set();
      return tabs.filter((tab) => {
        const key = normalizeUrl(tab.url);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function ensureCurrentTab() {
      const existing = state.tabs.find((tab) => normalizeUrl(tab.url) === currentUrl);
      if (existing) {
        existing.title = existing.title || currentTitle;
        existing.moduleSlug = existing.moduleSlug || currentModuleSlug;
        initialPaneEl.dataset.tabId = existing.id;
        initialPaneEl.dataset.tabUrl = existing.url;
        return existing;
      }
      const tab = {
        id: makeTabId(currentUrl),
        url: currentUrl,
        title: currentTitle,
        moduleSlug: currentModuleSlug,
        createdAt: Date.now(),
      };
      state.tabs.unshift(tab);
      initialPaneEl.dataset.tabId = tab.id;
      initialPaneEl.dataset.tabUrl = tab.url;
      return tab;
    }

    function getPaneByTabId(tabId) {
      return framesEl.querySelector(`.app-tab-pane[data-tab-id="${tabId}"]`) || null;
    }

    function getTabById(tabId) {
      return state.tabs.find((tab) => tab.id === tabId) || null;
    }

    function activateTab(tabId) {
      if (!getTabById(tabId)) return;
      state.activeTabId = tabId;
      framesEl.querySelectorAll(".app-tab-pane").forEach((pane) => {
        pane.classList.toggle("is-active", pane.dataset.tabId === tabId);
      });
      tabListEl.querySelectorAll(".app-tab-button").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.tabId === tabId);
        btn.setAttribute("aria-selected", btn.dataset.tabId === tabId ? "true" : "false");
      });
      writeState(state);
    }

    function bindFrameDocument(frame, tab) {
      try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc) return;
        const nextTitle = (frameDoc.title || tab.title || "").trim();
        if (nextTitle && tab.title !== nextTitle) {
          tab.title = nextTitle;
          renderTabs();
        }
        frameDoc.addEventListener("click", (event) => {
          const anchor = event.target.closest("a[href]");
          if (!shouldHandleLink(anchor, event)) return;
          event.preventDefault();
          openTab(anchor.href, titleFromLink(anchor));
        });
      } catch (_) {
        // Same-origin app pages are expected; ignore unexpected access errors.
      }
    }

    function validateLoadedFrame(frame, tab) {
      try {
        const pathname = frame.contentWindow?.location?.pathname || "";
        const title = (frame.contentDocument?.title || "").trim();
        if (pathname === "/login" || title.startsWith("403") || title.startsWith("404")) {
          closeTab(tab.id, { silent: true });
          return false;
        }
      } catch (_) {
        return true;
      }
      return true;
    }

    function createIframePane(tab) {
      if (getPaneByTabId(tab.id)) return;
      const pane = document.createElement("div");
      pane.className = "app-tab-pane";
      pane.dataset.tabId = tab.id;
      const frame = document.createElement("iframe");
      frame.className = "app-tab-frame";
      frame.setAttribute("loading", "eager");
      frame.setAttribute("title", tab.title || "页面页签");
      frame.src = buildFrameUrl(tab.url);
      frame.addEventListener("load", () => {
        if (!validateLoadedFrame(frame, tab)) return;
        bindFrameDocument(frame, tab);
      });
      pane.appendChild(frame);
      framesEl.appendChild(pane);
    }

    function renderTabs() {
      tabListEl.innerHTML = state.tabs.map((tab) => `
        <button type="button" class="app-tab-button ${state.activeTabId === tab.id ? "is-active" : ""}" data-tab-id="${tab.id}" role="tab" aria-selected="${state.activeTabId === tab.id ? "true" : "false"}" title="${tab.title}">
          <span class="app-tab-label">${tab.title}</span>
          <span class="app-tab-actions">
            <span class="app-tab-action app-tab-refresh" data-refresh-tab="${tab.id}" title="刷新" aria-label="刷新页签">↻</span>
            <span class="app-tab-action app-tab-close" data-close-tab="${tab.id}" title="关闭" aria-label="关闭页签">×</span>
          </span>
        </button>
      `).join("");
    }

    function refreshTab(tabId) {
      const tab = getTabById(tabId);
      if (!tab) return;
      const pane = getPaneByTabId(tabId);
      if (!pane) return;
      if (pane === initialPaneEl) {
        window.location.href = tab.url;
        return;
      }
      const frame = pane.querySelector(".app-tab-frame");
      if (!frame) return;
      frame.src = buildFrameUrl(tab.url);
    }

    function closeTab(tabId, options = {}) {
      if (state.tabs.length <= 1) {
        if (!options.silent) showToast("至少保留一个页签");
        return;
      }
      const index = state.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;
      const wasActive = state.activeTabId === tabId;
      state.tabs.splice(index, 1);
      const pane = getPaneByTabId(tabId);
      if (pane && pane !== initialPaneEl) pane.remove();
      if (wasActive) {
        const next = state.tabs[index] || state.tabs[index - 1] || state.tabs[0];
        state.activeTabId = next?.id || "";
      }
      renderTabs();
      if (state.activeTabId) activateTab(state.activeTabId);
      else writeState(state);
    }

    function openTab(inputUrl, inputTitle = "") {
      const url = normalizeUrl(inputUrl);
      if (!isEligibleUrl(url)) {
        window.location.href = inputUrl;
        return;
      }
      const existing = state.tabs.find((tab) => normalizeUrl(tab.url) === url);
      if (existing) {
        if (inputTitle && !existing.title) existing.title = inputTitle;
        renderTabs();
        activateTab(existing.id);
        return;
      }
      if (state.tabs.length >= MAX_TABS) {
        showToast(`最多只能同时打开 ${MAX_TABS} 个页签`);
        return;
      }
      const tab = {
        id: makeTabId(url),
        url,
        title: inputTitle || url,
        moduleSlug: "",
        createdAt: Date.now(),
      };
      state.tabs.push(tab);
      createIframePane(tab);
      renderTabs();
      activateTab(tab.id);
    }

    function restoreTabs() {
      state.tabs = dedupeTabs(state.tabs.filter((tab) => isEligibleUrl(tab.url)));
      const currentTab = ensureCurrentTab();
      state.activeTabId = getTabById(state.activeTabId)?.id || currentTab.id;
      initialPaneEl.dataset.tabId = currentTab.id;
      initialPaneEl.classList.add("app-tab-pane");
      state.tabs.forEach((tab) => {
        if (tab.id === currentTab.id) return;
        createIframePane(tab);
      });
      renderTabs();
      activateTab(state.activeTabId);
    }

    document.addEventListener("click", (event) => {
      const refreshBtn = event.target.closest("[data-refresh-tab]");
      if (refreshBtn) {
        event.preventDefault();
        event.stopPropagation();
        refreshTab(refreshBtn.dataset.refreshTab || "");
        return;
      }
      const closeBtn = event.target.closest("[data-close-tab]");
      if (closeBtn) {
        event.preventDefault();
        event.stopPropagation();
        closeTab(closeBtn.dataset.closeTab || "");
        return;
      }
      const tabBtn = event.target.closest(".app-tab-button");
      if (tabBtn) {
        activateTab(tabBtn.dataset.tabId || "");
        return;
      }
      const anchor = event.target.closest("a[href]");
      if (!shouldHandleLink(anchor, event)) return;
      event.preventDefault();
      openTab(anchor.href, titleFromLink(anchor));
    }, true);

    restoreTabs();
  });
})();
