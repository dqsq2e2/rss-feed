(function () {
  "use strict";

  var pending = new Map();
  var books = [];
  var savedLinks = [];
  var initialized = false;
  var selectedLinkId = "";
  var pendingDeleteId = "";
  var contextBook = null;
  var singleBookMode = false;

  var els = {
    refresh: document.getElementById("refreshBtn"),
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
    status: document.getElementById("status"),
    books: document.getElementById("books"),
    result: document.getElementById("result"),
    resultTitle: document.getElementById("resultTitle"),
    resultUrl: document.getElementById("resultUrl"),
    copy: document.getElementById("copyBtn"),
    toggleSelected: document.getElementById("toggleSelectedBtn"),
    deleteSelected: document.getElementById("deleteSelectedBtn"),
    savedLinks: document.getElementById("savedLinks")
  };

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
    var id = Date.now() + "-" + Math.random().toString(16).slice(2);
    return new Promise(function (resolve, reject) {
      var timer = window.setTimeout(function () {
        pending.delete(id);
        reject(new Error("请求超时"));
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
      window.parent.postMessage({ type: "ting-plugin:request", id: id, method: method, params: params }, "*");
    });
  }

  function invokeTool(name, input) {
    return bridgeRequest("capability.invoke", {
      capabilityId: "rss.tools",
      params: { name: name, input: input || {} }
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
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "ting-plugin:init") {
      contextBook = extractContextBook(data.context || {});
      singleBookMode = Boolean(contextBook && contextBook.id);
      applyMode();
      loadBooks();
      return;
    }
    if (data.type === "ting-plugin:response" && pending.has(data.id)) {
      var callbacks = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) callbacks.resolve(data.result);
      else callbacks.reject(new Error(data.error || "插件调用失败"));
    }
  });

  function extractContextBook(context) {
    var book = context.book || context.current_book || (context.reader && context.reader.book) || null;
    if (book && (book.id || book.book_id)) {
      return {
        id: book.id || book.book_id,
        title: book.title || book.name || "未命名有声书",
        author: book.author || "",
        narrator: book.narrator || "",
        library_id: book.library_id || ""
      };
    }
    var bookId = context.book_id || context.id;
    if (!bookId) return null;
    return {
      id: bookId,
      title: context.title || context.book_title || context.name || "未命名有声书",
      author: context.author || "",
      narrator: context.narrator || "",
      library_id: context.library_id || ""
    };
  }

  function applyMode() {
    document.body.classList.toggle("single-book", singleBookMode);
    if (singleBookMode) {
      els.generateTab.textContent = "生成本书订阅";
      els.savedTab.textContent = "本书链接";
      els.search.value = "";
      els.refresh.title = "刷新本书订阅";
    }
  }

  function loadBooks() {
    setStatus(singleBookMode ? "加载本书订阅" : "加载书籍");
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
        ? ((contextBook && contextBook.title ? contextBook.title : "本书") + " RSS 订阅")
        : (books.length ? "选择一本书生成订阅链接" : "没有找到书籍"));
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
        '<strong>' + escapeHtml(book && book.title ? book.title : "未命名有声书") + '</strong>',
        '<span>' + escapeHtml(meta || "当前书籍") + '</span>',
        '</div>',
        '<button type="button" data-single-generate>生成</button>',
        '</article>'
      ].join("");
      var button = els.books.querySelector("button[data-single-generate]");
      if (button) button.addEventListener("click", function () {
        if (book) signBook(book);
      });
      return;
    }
    if (!books.length) {
      els.books.innerHTML = '<div class="empty">没有可显示的书籍</div>';
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
        '<button type="button" data-index="' + index + '">生成</button>',
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
    var baseTitle = singleBookMode ? "本书链接" : "已生成";
    els.savedTab.textContent = savedLinks.length ? baseTitle + " (" + savedLinks.length + ")" : baseTitle;
    if (!savedLinks.length) {
      els.savedLinks.innerHTML = '<div class="empty">暂无已生成链接</div>';
      if (selectedLinkId) clearSelectedLink();
      return;
    }
    els.savedLinks.innerHTML = savedLinks.map(function (link, index) {
      var disabled = link.enabled === false;
      var meta = [
        expiryText(link.expires_days),
        link.chapter_limit ? "章节 " + link.chapter_limit : "全部章节",
        link.media === false ? "无音频" : String(link.transcode || "original").toUpperCase()
      ].join(" / ");
      return [
        '<article class="saved-link' + (disabled ? ' disabled' : '') + '">',
        '<div>',
        '<strong>' + escapeHtml(link.title || "未命名有声书") + (disabled ? ' <em>已禁用</em>' : '') + '</strong>',
        '<span>' + escapeHtml(meta) + '</span>',
        '</div>',
        '<div class="saved-link-actions">',
        '<button type="button" data-action="copy" data-saved-index="' + index + '"' + (disabled ? ' disabled' : '') + '>复制</button>',
        '<button type="button" data-action="toggle" data-saved-index="' + index + '">' + (disabled ? '启用' : '禁用') + '</button>',
        '<button class="danger" type="button" data-action="delete" data-saved-index="' + index + '">' + (pendingDeleteId === link.id ? '确认删除' : '删除') + '</button>',
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
    setStatus("生成订阅链接");
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
      setStatus("订阅链接已生成");
    }).catch(function (error) {
      setStatus(error.message || String(error), true);
    });
  }

  function showGeneratedResult(result, fallbackBook) {
    var book = result.book || fallbackBook || {};
    var link = result.saved_link || null;
    switchTab("saved");
    els.result.hidden = false;
    els.resultTitle.textContent = (book.title || "未命名有声书") + " 的 RSS 链接";
    els.resultUrl.value = result.url || result.signed_url || "";
    selectedLinkId = link && link.id ? link.id : "";
    updateResultActions(link);
    revealResult();
  }

  function showSavedLink(link) {
    switchTab("saved");
    els.result.hidden = false;
    els.resultTitle.textContent = (link.title || "未命名有声书") + " 的 RSS 链接";
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
    els.toggleSelected.textContent = disabled ? "启用" : "禁用";
    els.deleteSelected.textContent = hasLink && pendingDeleteId === link.id ? "确认删除" : "删除";
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
      setStatus("链接已禁用，无法复制", true);
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
    setStatus(enabled ? "启用订阅链接" : "禁用订阅链接");
    invokeTool(enabled ? "rss.enable_link" : "rss.disable_link", {
      link_id: link.id
    }).then(function (result) {
      savedLinks = result.saved_links || savedLinks;
      renderSavedLinks();
      var selected = findSavedLink(selectedLinkId);
      if (selected) showSavedLink(selected);
      setStatus(enabled ? "订阅链接已启用" : "订阅链接已禁用");
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
      setStatus("再次点击确认删除，删除后链接将无法继续访问", true);
      return;
    }
    deleteLink(link);
  }

  function deleteLink(link) {
    if (!link || !link.id) return;
    setStatus("删除订阅链接");
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
      setStatus("订阅链接已删除");
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
        setStatus("订阅链接已复制");
      }).catch(function () {
        document.execCommand("copy");
        setStatus("订阅链接已复制");
      });
    } else {
      document.execCommand("copy");
      setStatus("订阅链接已复制");
    }
  }

  function optionalNumber(value) {
    var text = String(value || "").trim();
    if (!text) return null;
    var number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function expiryText(days) {
    return Number(days) === 0 ? "永久" : String(days || 30) + " 天";
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
