(function () {
  "use strict";

  var pending = new Map();
  var bridgeToken = null;
  var books = [];
  var savedLinks = [];
  var initialized = false;
  var selectedLinkId = "";
  var pendingDeleteId = "";
  var contextBook = null;
  var singleBookMode = false;
  var language = "zh-CN";
  var text = {
    zh: {
      title: "RSS 订阅",
      refresh: "刷新",
      refreshBook: "刷新本书订阅",
      tabs: "RSS 订阅视图",
      generateTab: "生成订阅",
      savedTab: "已生成",
      generateBookTab: "生成本书订阅",
      bookLinksTab: "本书链接",
      searchPlaceholder: "搜索书名、作者或演播者",
      search: "搜索",
      expires: "订阅有效期",
      mediaExpires: "音频有效期",
      chapters: "章节数量",
      cacheSeconds: "RSS 缓存秒数",
      audio: "音频",
      permanent: "永久",
      days: " 天",
      all: "全部",
      original: "原始",
      noMedia: "不包含",
      loading: "加载中",
      timeout: "请求超时",
      callFailed: "插件调用失败",
      unnamedBook: "未命名有声书",
      currentBook: "当前书籍",
      loadBookFeed: "加载本书订阅",
      loadBooks: "加载书籍",
      bookFeed: " RSS 订阅",
      chooseBook: "选择一本书生成订阅链接",
      noBooks: "没有找到书籍",
      noVisibleBooks: "没有可显示的书籍",
      generate: "生成",
      generated: "已生成",
      savedLinks: "已生成链接",
      noSavedLinks: "暂无已生成链接",
      chapterCount: "章节 ",
      allChapters: "全部章节",
      noAudio: "无音频",
      disabled: "已禁用",
      copy: "复制",
      enable: "启用",
      disable: "禁用",
      delete: "删除",
      confirmDelete: "确认删除",
      generateLink: "生成订阅链接",
      linkGenerated: "订阅链接已生成",
      linkSuffix: " 的 RSS 链接",
      linkDisabled: "链接已禁用，无法复制",
      enableLink: "启用订阅链接",
      disableLink: "禁用订阅链接",
      linkEnabled: "订阅链接已启用",
      linkDisabledDone: "订阅链接已禁用",
      confirmDeleteHint: "再次点击确认删除，删除后链接将无法继续访问",
      deleteLink: "删除订阅链接",
      linkDeleted: "订阅链接已删除",
      linkCopied: "订阅链接已复制"
    },
    en: {
      title: "RSS Feeds",
      refresh: "Refresh",
      refreshBook: "Refresh this book feed",
      tabs: "RSS feed views",
      generateTab: "Create feed",
      savedTab: "Saved",
      generateBookTab: "Create this book feed",
      bookLinksTab: "This book",
      searchPlaceholder: "Search title, author, or narrator",
      search: "Search",
      expires: "Feed expiry",
      mediaExpires: "Audio expiry",
      chapters: "Chapters",
      cacheSeconds: "RSS cache seconds",
      audio: "Audio",
      permanent: "Never expires",
      days: " days",
      all: "All",
      original: "Original",
      noMedia: "Exclude",
      loading: "Loading",
      timeout: "Request timed out",
      callFailed: "Plugin call failed",
      unnamedBook: "Untitled audiobook",
      currentBook: "Current book",
      loadBookFeed: "Loading this book feed",
      loadBooks: "Loading books",
      bookFeed: " RSS feed",
      chooseBook: "Choose a book to create a feed",
      noBooks: "No books found",
      noVisibleBooks: "No books to show",
      generate: "Create",
      generated: "Saved",
      savedLinks: "Saved feeds",
      noSavedLinks: "No saved feeds yet",
      chapterCount: "Chapters: ",
      allChapters: "All chapters",
      noAudio: "No audio",
      disabled: "Disabled",
      copy: "Copy",
      enable: "Enable",
      disable: "Disable",
      delete: "Delete",
      confirmDelete: "Confirm delete",
      generateLink: "Creating feed",
      linkGenerated: "Feed created",
      linkSuffix: " RSS feed",
      linkDisabled: "This feed is disabled and cannot be copied",
      enableLink: "Enabling feed",
      disableLink: "Disabling feed",
      linkEnabled: "Feed enabled",
      linkDisabledDone: "Feed disabled",
      confirmDeleteHint: "Click delete again to confirm. The feed will stop working.",
      deleteLink: "Deleting feed",
      linkDeleted: "Feed deleted",
      linkCopied: "Feed copied"
    }
  };

  var els = {
    title: document.getElementById("title"),
    refresh: document.getElementById("refreshBtn"),
    tabs: document.getElementById("tabs"),
    generateTab: document.getElementById("generateTab"),
    savedTab: document.getElementById("savedTab"),
    generatePanel: document.getElementById("generatePanel"),
    savedPanel: document.getElementById("savedPanel"),
    search: document.getElementById("searchInput"),
    searchBtn: document.getElementById("searchBtn"),
    expires: document.getElementById("expiresSelect"),
    mediaExpires: document.getElementById("mediaExpiresSelect"),
    chapterLimit: document.getElementById("chapterLimitInput"),
    cacheSeconds: document.getElementById("cacheSecondsInput"),
    media: document.getElementById("mediaSelect"),
    expiresLabel: document.getElementById("expiresLabel"),
    mediaExpiresLabel: document.getElementById("mediaExpiresLabel"),
    chapterLimitLabel: document.getElementById("chapterLimitLabel"),
    cacheSecondsLabel: document.getElementById("cacheSecondsLabel"),
    mediaLabel: document.getElementById("mediaLabel"),
    status: document.getElementById("status"),
    books: document.getElementById("books"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("resultTitle"),
    resultUrl: document.getElementById("resultUrl"),
    copy: document.getElementById("copyBtn"),
    toggleSelected: document.getElementById("toggleSelectedBtn"),
    deleteSelected: document.getElementById("deleteSelectedBtn"),
    savedLinks: document.getElementById("savedLinks"),
    savedSectionTitle: document.getElementById("savedSectionTitle")
  };

  function isEnglish() {
    return /^en(?:-|$)/i.test(language);
  }

  function t(key) {
    var locale = isEnglish() ? text.en : text.zh;
    return locale[key] || text.zh[key] || key;
  }

  function applyLanguage(value) {
    language = value || "zh-CN";
    document.documentElement.lang = isEnglish() ? "en" : "zh-CN";
    document.title = t("title");
    els.title.textContent = t("title");
    els.refresh.textContent = t("refresh");
    els.refresh.title = t("refresh");
    els.tabs.setAttribute("aria-label", t("tabs"));
    els.search.placeholder = t("searchPlaceholder");
    els.searchBtn.textContent = t("search");
    els.expiresLabel.textContent = t("expires");
    els.mediaExpiresLabel.textContent = t("mediaExpires");
    els.chapterLimitLabel.textContent = t("chapters");
    els.chapterLimit.placeholder = t("all");
    els.cacheSecondsLabel.textContent = t("cacheSeconds");
    els.mediaLabel.textContent = t("audio");
    els.savedSectionTitle.textContent = t("savedLinks");
    els.copy.textContent = t("copy");
    Array.prototype.forEach.call(els.expires.options, function (option) {
      option.textContent = option.value === "0" ? t("permanent") : option.value + t("days");
    });
    Array.prototype.forEach.call(els.mediaExpires.options, function (option) {
      option.textContent = option.value === "0" ? t("permanent") : option.value + t("days");
    });
    Array.prototype.forEach.call(els.media.options, function (option) {
      if (option.value === "original") option.textContent = t("original");
      if (option.value === "none") option.textContent = t("noMedia");
    });
    applyMode();
    renderBooks();
    renderSavedLinks();
    updateResultActions(findSavedLink(selectedLinkId));
    setStatus(t("loading"));
  }

  function loadLanguage() {
    return bridgeRequest("host.invoke", {
      method: "user_settings.get",
      params: { key: "language" }
    }).then(function (result) {
      applyLanguage(result && result.value);
    }).catch(function () {
      applyLanguage("zh-CN");
    });
  }

  function setStatus(text, failed) {
    els.status.textContent = text;
    els.status.classList.toggle("error", Boolean(failed));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function serverOrigin() {
    return firstOrigin(
      window.location && window.location.origin,
      window.location && window.location.href,
      document.baseURI,
      document.referrer
    );
  }

  function firstOrigin() {
    for (var i = 0; i < arguments.length; i += 1) {
      var candidate = arguments[i];
      if (!candidate || candidate === "null") continue;
      try {
        var origin = new URL(candidate, document.baseURI || undefined).origin;
        if (/^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "");
      } catch (_) {}
    }
    return "";
  }

  function bridgeRequest(method, params) {
    if (!bridgeToken) {
      return Promise.reject(new Error(t("loading")));
    }
    var id = Date.now() + "-" + Math.random().toString(16).slice(2);
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        pending.delete(id);
        reject(new Error(t("timeout")));
      }, 30000);
      pending.set(id, {
        resolve: function (value) {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: function (error) {
          window.clearTimeout(timer);
          reject(error);
        }
      });
      window.__TING_PLUGIN_BRIDGE__.postMessage({
        type: "ting-plugin:request",
        id: id,
        method: method,
        params: params,
        bridge_token: bridgeToken
      });
    });
  }

  function invokeTool(name, input) {
    return bridgeRequest("capability.invoke", {
      capabilityId: "rss.tools",
      params: { tool_name: name, params: input || {} }
    });
  }

  function switchTab(tab) {
    var saved = tab === "saved";
    els.generatePanel.hidden = saved;
    els.savedPanel.hidden = !saved;
    els.generateTab.classList.toggle("active", !saved);
    els.savedTab.classList.toggle("active", saved);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "ting-plugin:init") {
      bridgeToken = data.bridgeToken || null;
      contextBook = extractContextBook(data.context || {});
      singleBookMode = Boolean(contextBook && contextBook.id);
      loadLanguage().then(function () {
        applyMode();
        loadBooks();
      });
      return;
    }
    if (data.type === "ting-plugin:response" && data.bridge_token === bridgeToken && pending.has(data.id)) {
      var callbacks = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) callbacks.resolve(data.result);
      else callbacks.reject((window.__TING_PLUGIN_BRIDGE__.createError
        ? window.__TING_PLUGIN_BRIDGE__.createError(data.error, t("callFailed"))
        : new Error(typeof data.error === "string" ? data.error : t("callFailed"))));
    }
  });

  function extractContextBook(context) {
    var book = context.book || context.current_book || (context.reader && context.reader.book) || null;
    if (book && (book.id || book.book_id)) {
      return {
        id: book.id || book.book_id,
        title: book.title || book.name || "",
        author: book.author || "",
        narrator: book.narrator || "",
        library_id: book.library_id || ""
      };
    }
    var bookId = context.book_id || context.id;
    if (!bookId) return null;
    return {
      id: bookId,
      title: context.title || context.book_title || context.name || "",
      author: context.author || "",
      narrator: context.narrator || "",
      library_id: context.library_id || ""
    };
  }

  function applyMode() {
    document.body.classList.toggle("single-book", singleBookMode);
    els.generateTab.textContent = singleBookMode ? t("generateBookTab") : t("generateTab");
    els.savedTab.textContent = singleBookMode ? t("bookLinksTab") : t("savedTab");
    els.refresh.title = singleBookMode ? t("refreshBook") : t("refresh");
    if (singleBookMode) {
      els.search.value = "";
    }
  }

  function loadBooks() {
    setStatus(singleBookMode ? t("loadBookFeed") : t("loadBooks"));
    invokeTool("rss.state", {
      book_id: singleBookMode && contextBook ? contextBook.id : "",
      search: singleBookMode ? "" : els.search.value,
      limit: 80,
      origin: serverOrigin()
    }).then(function (result) {
      var allBooks = result.books || [];
      books = singleBookMode ? [contextBook] : allBooks;
      savedLinks = filterSavedLinks(result.saved_links || []);
      applyDefaults(result.config || {});
      renderBooks();
      renderSavedLinks();
      if (!initialized && savedLinks.length) {
        initialized = true;
        showSavedLink(savedLinks[0]);
      } else if (!initialized) {
        initialized = true;
        switchTab("generate");
      }
      setStatus(singleBookMode
        ? ((contextBook && contextBook.title ? contextBook.title : t("currentBook")) + t("bookFeed"))
        : (books.length ? t("chooseBook") : t("noBooks")));
    }).catch(function (error) {
      setStatus(error.message || String(error), true);
    });
  }

  function filterSavedLinks(links) {
    if (!singleBookMode || !contextBook || !contextBook.id) return links;
    return links.filter(function (link) {
      return link.book_id === contextBook.id;
    });
  }

  function applyDefaults(config) {
    if (config.rss_link_expires_days !== undefined && !els.expires.dataset.touched) {
      els.expires.value = String(config.rss_link_expires_days);
    }
    if (config.media_url_expires_days !== undefined && !els.mediaExpires.dataset.touched) {
      els.mediaExpires.value = String(config.media_url_expires_days);
    }
    if (config.media_transcode && !els.media.dataset.touched) {
      els.media.value = config.media_transcode === "original" ? "original" : config.media_transcode;
    }
    if (config.cache_max_age_seconds !== undefined && !els.cacheSeconds.dataset.touched) {
      els.cacheSeconds.value = String(config.cache_max_age_seconds);
    }
  }

  function renderBooks() {
    if (singleBookMode) {
      var book = contextBook || books[0];
      var meta = book ? [book.author, book.narrator].filter(Boolean).join(" / ") : "";
      els.books.innerHTML = [
        '<article class="book single-target">',
        '<div>',
        '<strong>' + escapeHtml(book && book.title ? book.title : t("unnamedBook")) + '</strong>',
        '<span>' + escapeHtml(meta || t("currentBook")) + '</span>',
        '</div>',
        '<button type="button" data-single-generate>' + t("generate") + '</button>',
        '</article>'
      ].join("");
      var button = els.books.querySelector("button[data-single-generate]");
      if (button) button.addEventListener("click", function () {
        if (book) signBook(book);
      });
      return;
    }
    if (!books.length) {
      els.books.innerHTML = '<div class="empty">' + t("noVisibleBooks") + '</div>';
      return;
    }
    els.books.innerHTML = books.map(function (book, index) {
      var meta = [book.author, book.narrator].filter(Boolean).join(" / ");
      return [
        '<article class="book">',
        '<div>',
        '<strong>' + escapeHtml(book.title) + '</strong>',
        '<span>' + escapeHtml(meta || book.id) + '</span>',
        '</div>',
        '<button type="button" data-index="' + index + '">' + t("generate") + '</button>',
        '</article>'
      ].join("");
    }).join("");
    var buttons = els.books.querySelectorAll("button[data-index]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        var book = books[Number(this.getAttribute("data-index"))];
        if (book) signBook(book);
      });
    }
  }

  function renderSavedLinks() {
    var baseTitle = singleBookMode ? t("bookLinksTab") : t("savedTab");
    els.savedTab.textContent = savedLinks.length ? baseTitle + " (" + savedLinks.length + ")" : baseTitle;
    if (!savedLinks.length) {
      els.savedLinks.innerHTML = '<div class="empty">' + t("noSavedLinks") + '</div>';
      if (selectedLinkId) clearSelectedLink();
      return;
    }
    els.savedLinks.innerHTML = savedLinks.map(function (link, index) {
      var disabled = link.enabled === false;
      var meta = [
        expiryText(link.expires_days),
        link.chapter_limit ? t("chapterCount") + link.chapter_limit : t("allChapters"),
        link.media === false ? t("noAudio") : String(link.transcode || "original").toUpperCase()
      ].join(" / ");
      return [
        '<article class="saved-link' + (disabled ? ' disabled' : '') + '">',
        '<div>',
        '<strong>' + escapeHtml(link.title || t("unnamedBook")) + (disabled ? ' <em>' + t("disabled") + '</em>' : '') + '</strong>',
        '<span>' + escapeHtml(meta) + '</span>',
        '</div>',
        '<div class="saved-link-actions">',
        '<button type="button" data-action="copy" data-saved-index="' + index + '"' + (disabled ? ' disabled' : '') + '>' + t("copy") + '</button>',
        '<button type="button" data-action="toggle" data-saved-index="' + index + '">' + (disabled ? t("enable") : t("disable")) + '</button>',
        '<button class="danger" type="button" data-action="delete" data-saved-index="' + index + '">' + (pendingDeleteId === link.id ? t("confirmDelete") : t("delete")) + '</button>',
        '</div>',
        '</article>'
      ].join("");
    }).join("");
    var buttons = els.savedLinks.querySelectorAll("button[data-action]");
    for (var i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function () {
        var link = savedLinks[Number(this.getAttribute("data-saved-index"))];
        if (!link) return;
        var action = this.getAttribute("data-action");
        if (action === "copy") {
          pendingDeleteId = "";
          showSavedLink(link);
          copyText(link.url);
        } else if (action === "toggle") {
          pendingDeleteId = "";
          setLinkEnabled(link, link.enabled === false);
        } else if (action === "delete") {
          requestDeleteLink(link);
        }
      });
    }
  }

  function signBook(book) {
    setStatus(t("generateLink"));
    var media = els.media.value;
    invokeTool("rss.sign_book_feed", {
      book_id: book.id,
      origin: serverOrigin(),
      expires_days: Number(els.expires.value),
      media_expires_days: Number(els.mediaExpires.value),
      chapter_limit: optionalNumber(els.chapterLimit.value),
      cache_seconds: Number(els.cacheSeconds.value || 300),
      media: media !== "none",
      transcode: media === "none" ? "mp3" : media
    }).then(function (result) {
      savedLinks = result.saved_links || savedLinks;
      showGeneratedResult(result, book);
      renderSavedLinks();
      setStatus(t("linkGenerated"));
    }).catch(function (error) {
      setStatus(error.message || String(error), true);
    });
  }

  function showGeneratedResult(result, fallbackBook) {
    var book = result.book || fallbackBook || {};
    var link = result.saved_link || null;
    switchTab("saved");
    els.result.hidden = false;
    els.resultTitle.textContent = (book.title || t("unnamedBook")) + t("linkSuffix");
    els.resultUrl.value = result.url || result.signed_url || "";
    selectedLinkId = link && link.id ? link.id : "";
    updateResultActions(link);
    revealResult();
  }

  function showSavedLink(link) {
    switchTab("saved");
    els.result.hidden = false;
    els.resultTitle.textContent = (link.title || t("unnamedBook")) + t("linkSuffix");
    els.resultUrl.value = link.url || "";
    selectedLinkId = link.id || "";
    updateResultActions(link);
    revealResult();
  }

  function clearSelectedLink() {
    selectedLinkId = "";
    els.result.hidden = true;
    els.resultUrl.value = "";
    updateResultActions(null);
  }

  function updateResultActions(link) {
    var hasLink = Boolean(link && link.id);
    var disabled = hasLink && link.enabled === false;
    els.copy.disabled = disabled;
    els.toggleSelected.hidden = !hasLink;
    els.deleteSelected.hidden = !hasLink;
    els.toggleSelected.disabled = !hasLink;
    els.deleteSelected.disabled = !hasLink;
    els.toggleSelected.textContent = disabled ? t("enable") : t("disable");
    els.deleteSelected.textContent = hasLink && pendingDeleteId === link.id ? t("confirmDelete") : t("delete");
    els.result.classList.toggle("disabled", disabled);
  }

  function revealResult() {
    window.setTimeout(function () {
      els.savedPanel.scrollTop = 0;
    }, 0);
  }

  function copyResult() {
    var selected = findSavedLink(selectedLinkId);
    if (selected && selected.enabled === false) {
      setStatus(t("linkDisabled"), true);
      return;
    }
    copyText(els.resultUrl.value);
  }

  function findSavedLink(id) {
    if (!id) return null;
    for (var i = 0; i < savedLinks.length; i += 1) {
      if (savedLinks[i].id === id) return savedLinks[i];
    }
    return null;
  }

  function setLinkEnabled(link, enabled) {
    if (!link || !link.id) return;
    pendingDeleteId = "";
    setStatus(enabled ? t("enableLink") : t("disableLink"));
    invokeTool(enabled ? "rss.enable_link" : "rss.disable_link", {
      link_id: link.id
    }).then(function (result) {
      savedLinks = result.saved_links || savedLinks;
      renderSavedLinks();
      var selected = findSavedLink(selectedLinkId);
      if (selected) showSavedLink(selected);
      setStatus(enabled ? t("linkEnabled") : t("linkDisabledDone"));
    }).catch(function (error) {
      setStatus(error.message || String(error), true);
    });
  }

  function requestDeleteLink(link) {
    if (!link || !link.id) return;
    if (pendingDeleteId !== link.id) {
      pendingDeleteId = link.id;
      renderSavedLinks();
      var selected = findSavedLink(selectedLinkId);
      updateResultActions(selected);
      setStatus(t("confirmDeleteHint"), true);
      return;
    }
    deleteLink(link);
  }

  function deleteLink(link) {
    if (!link || !link.id) return;
    setStatus(t("deleteLink"));
    invokeTool("rss.delete_link", {
      link_id: link.id
    }).then(function (result) {
      var deletedSelected = selectedLinkId === link.id;
      pendingDeleteId = "";
      savedLinks = result.saved_links || savedLinks;
      renderSavedLinks();
      if (deletedSelected) {
        if (savedLinks.length) showSavedLink(savedLinks[0]);
        else clearSelectedLink();
      }
      setStatus(t("linkDeleted"));
    }).catch(function (error) {
      pendingDeleteId = "";
      renderSavedLinks();
      var selected = findSavedLink(selectedLinkId);
      updateResultActions(selected);
      setStatus(error.message || String(error), true);
    });
  }

  function copyText(value) {
    if (!value) return;
    els.resultUrl.value = value;
    els.resultUrl.focus();
    els.resultUrl.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () {
        setStatus(t("linkCopied"));
      }).catch(function () {
        document.execCommand("copy");
        setStatus(t("linkCopied"));
      });
    } else {
      document.execCommand("copy");
      setStatus(t("linkCopied"));
    }
  }

  function optionalNumber(value) {
    var text = String(value || "").trim();
    if (!text) return null;
    var number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function expiryText(days) {
    return Number(days) === 0 ? t("permanent") : String(days || 30) + t("days");
  }

  function markTouched(event) {
    event.currentTarget.dataset.touched = "1";
  }

  function bind() {
    els.generateTab.addEventListener("click", function () {
      switchTab("generate");
    });
    els.savedTab.addEventListener("click", function () {
      if (savedLinks.length && els.result.hidden) showSavedLink(savedLinks[0]);
      else switchTab("saved");
    });
    els.refresh.addEventListener("click", loadBooks);
    els.searchBtn.addEventListener("click", loadBooks);
    els.search.addEventListener("keydown", function (event) {
      if (event.key === "Enter") loadBooks();
    });
    els.expires.addEventListener("change", markTouched);
    els.mediaExpires.addEventListener("change", markTouched);
    els.chapterLimit.addEventListener("input", markTouched);
    els.cacheSeconds.addEventListener("input", markTouched);
    els.media.addEventListener("change", markTouched);
    els.copy.addEventListener("click", copyResult);
    els.toggleSelected.addEventListener("click", function () {
      var link = findSavedLink(selectedLinkId);
      if (link) setLinkEnabled(link, link.enabled === false);
    });
    els.deleteSelected.addEventListener("click", function () {
      var link = findSavedLink(selectedLinkId);
      if (link) requestDeleteLink(link);
    });
  }

  bind();
  window.setTimeout(function () {
    if (!books.length) loadBooks();
  }, 800);
})();
