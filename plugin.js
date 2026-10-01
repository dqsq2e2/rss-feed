"use strict";
import { success, readResource, encodeBase64 } from "./sdk.mjs";

const PLUGIN_NAME = "Ting Reader RSS Feed Plugin";
const DEFAULT_FEED_TITLE = "Ting Reader";
const DEFAULT_FEED_DESCRIPTION = "当前用户可访问的 Ting Reader 馆藏更新";
const ALL_LIBRARY_ALIASES = new Set(["", "all", "any", "*"]);
const SAVED_LINKS_CACHE_KEY = "rss.saved_links.v2";
const MAX_SAVED_LINK_RECORDS = 100;
const MAX_VISIBLE_SAVED_LINKS = 20;
const DEFAULT_RSS_LINK_EXPIRES_DAYS = 30;
const DEFAULT_MEDIA_URL_EXPIRES_DAYS = 365;
const DEFAULT_CACHE_MAX_AGE_SECONDS = 300;
const DEFAULT_COVER_CACHE_MAX_AGE_SECONDS = 86400;
const DEFAULT_MEDIA_TRANSCODE = "mp3";

async function openRssPanel() {
  return {
    ok: true,
    config: publicConfig(),
  };
}

async function invokeTool(params) {
  const name = params?.tool_name;
  const input = params?.params || {};

  switch (name) {
    case "rss.state":
      return rssState(input);
    case "rss.sign_book_feed":
      return signBookFeed(input);
    case "rss.disable_link":
      return setSavedLinkEnabled(input, false);
    case "rss.enable_link":
      return setSavedLinkEnabled(input, true);
    case "rss.delete_link":
      return deleteSavedLink(input);
    default:
      throw new Error(`Unknown RSS tool: ${name}`);
  }
}

async function rssState(input) {
  const config = readConfig();
  const origin = normalizeBaseUrl(firstText(input?.origin, input?.server_origin, ""));
  const bookId = firstText(input?.book_id, input?.id, "");
  const savedLinks = bookId
    ? (await loadSavedLinks()).filter((link) => link.book_id === bookId)
    : await loadSavedLinks();
  const result = bookId
    ? { items: [await hostInvoke("books.get", { book_id: bookId })], total: 1, offset: 0, limit: 1 }
    : await hostInvoke("books.list", compactObject({
      search: firstText(input?.search, input?.query, ""),
      library_id: firstText(input?.library_id, ""),
      limit: integerValue(input?.limit, 50, 1, 200),
      offset: integerValue(input?.offset, 0, 0, 100000),
    }));
  return {
    ok: true,
    books: Array.isArray(result?.items) ? result.items.map(compactBook) : [],
    total: numberValue(result?.total, 0),
    offset: numberValue(result?.offset, 0),
    limit: numberValue(result?.limit, 50),
    config: publicConfig(config, origin),
    saved_links: savedLinks,
  };
}

async function signBookFeed(input) {
  const config = readConfig();
  const bookId = firstText(input?.book_id, input?.id, "");
  if (!bookId) {
    throw new Error("rss.sign_book_feed requires book_id");
  }

  const book = await hostInvoke("books.get", { book_id: bookId });
  const origin = normalizeBaseUrl(firstText(input?.origin, input?.server_origin, ""));
  const baseUrl = firstText(config.publicBaseUrl, origin, "");
  const expiresDays = daysValue(input?.expires_days, config.rssLinkExpiresDays, 30);
  const mediaExpiresDays = daysValue(input?.media_expires_days, config.mediaUrlExpiresDays, 365);
  const chapterLimit = optionalIntegerValue(input?.chapter_limit, null, 1, 1000000);
  const cacheSeconds = integerValue(input?.cache_seconds, config.cacheMaxAgeSeconds, 0, 86400);
  const media = input?.media !== false;
  const transcode = normalizeMediaTranscode(firstText(input?.transcode, config.mediaTranscode));
  const path = `/rss/book/${bookId}/feed.xml`;
  const linkId = createLinkId();
  const signed = await hostInvoke("plugin_routes.sign", {
    method: "GET",
    path,
    expires_in_seconds: expiresSecondsFromDays(expiresDays),
    bind_current_user: true,
  });
  const query = [`link_id=${encodeURIComponent(linkId)}`];
  if (!media) query.push("media=0");
  if (transcode) query.push(`transcode=${encodeURIComponent(transcode)}`);
  if (chapterLimit !== null) query.push(`limit=${encodeURIComponent(String(chapterLimit))}`);
  query.push(`cache=${encodeURIComponent(String(cacheSeconds))}`);
  query.push(`media_expires_days=${encodeURIComponent(String(mediaExpiresDays))}`);
  const signedUrl = appendQuery(signed.signed_url, query.join("&"));
  const absolute = baseUrl ? absoluteUrl(baseUrl, signedUrl) : signedUrl;
  const entry = compactSavedLink({
    id: linkId,
    book_id: bookId,
    title: firstText(book?.title, book?.name, "未命名有声书"),
    author: firstText(book?.author, ""),
    narrator: firstText(book?.narrator, ""),
    url: absolute,
    signed_url: signedUrl,
    path,
    expires: signed.expires,
    expires_days: expiresDays,
    media_expires_days: mediaExpiresDays,
    chapter_limit: chapterLimit,
    cache_seconds: cacheSeconds,
    media,
    transcode: transcode || "original",
    enabled: true,
    deleted: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const savedLinks = await saveSavedLink(entry);

  return {
    ok: true,
    book: compactBook(book),
    path,
    url: absolute,
    signed_url: signedUrl,
    expires: signed.expires,
    expires_days: expiresDays,
    media_expires_days: mediaExpiresDays,
    chapter_limit: chapterLimit,
    cache_seconds: cacheSeconds,
    media,
    transcode: transcode || "original",
    saved_link: entry,
    saved_links: savedLinks,
  };
}

async function generateRssFeed(request) {
  try {
    const config = readConfig();
    const query = parseQuery(request?.query || "");
    const routeLibraryId = String(request?.params?.library_id || "all");
    const libraryId = ALL_LIBRARY_ALIASES.has(routeLibraryId.toLowerCase()) ? "" : routeLibraryId;
    const limit = optionalIntegerValue(query.limit, null, 1, 1000000);
    const offset = integerValue(query.offset, 0, 0, 1000000);
    const cacheMaxAgeSeconds = integerValue(
      firstText(query.cache, query.cache_seconds, query.cache_max_age_seconds),
      config.cacheMaxAgeSeconds,
      0,
      86400,
    );
    const runtimeConfig = Object.assign({}, config, { cacheMaxAgeSeconds });
    const includeChapters = booleanQuery(query.chapters, config.includeChapterOutline);
    const chapterPreviewCount = integerValue(
      query.chapter_preview_count,
      config.chapterPreviewCount,
      0,
      10,
    );

    const library = libraryId
      ? await hostInvoke("libraries.get", { library_id: libraryId })
      : null;

    const booksResult = await loadFeedBooks(libraryId, query, limit, offset);

    const origin = requestOrigin(request, config);
    const books = Array.isArray(booksResult?.items) ? booksResult.items : [];
    const items = [];
    for (const book of books) {
      items.push({
        book: await withPreparedCoverUrl(book, origin, query),
        chapters: includeChapters
          ? await loadChapterPreview(book, chapterPreviewCount)
          : null,
      });
    }

    const feedXml = buildRss({
      request,
      config: runtimeConfig,
      query,
      origin,
      library,
      libraryId,
      total: numberValue(booksResult?.total, books.length),
      items,
    });

    return {
      status: 200,
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": cacheControlHeader(runtimeConfig.cacheMaxAgeSeconds),
      },
      body: feedXml,
    };
  } catch (error) {
    Ting?.log?.warn?.(`RSS feed generation failed: ${error}`);
    return errorResponse(error);
  }
}

async function generateBookRssFeed(request) {
  try {
    const config = readConfig();
    const query = parseQuery(request?.query || "");
    const bookId = String(request?.params?.book_id || "");
    if (!bookId) {
      throw new Error("Missing book_id");
    }

    await requireActiveSavedLink(query, {
      book_id: bookId,
      path: `/rss/book/${bookId}/feed.xml`,
    });

    const book = await hostInvoke("books.get", { book_id: bookId });
    const chapterLimit = optionalIntegerValue(query.limit, null, 1, 1000000);
    const offset = integerValue(query.offset, 0, 0, 1000000);
    const cacheMaxAgeSeconds = integerValue(
      firstText(query.cache, query.cache_seconds, query.cache_max_age_seconds),
      config.cacheMaxAgeSeconds,
      0,
      86400,
    );
    const mediaExpiresDays = daysValue(
      query.media_expires_days,
      config.mediaUrlExpiresDays,
      365,
    );
    const runtimeConfig = Object.assign({}, config, {
      cacheMaxAgeSeconds,
      mediaUrlExpiresDays: mediaExpiresDays,
    });
    const chaptersResult = await loadBookChapters(bookId, chapterLimit, offset);
    const chapters = Array.isArray(chaptersResult?.items) ? chaptersResult.items : [];
    const includeMedia = booleanQuery(query.media, true);
    const mediaTranscode = normalizeMediaTranscode(firstText(query.transcode, config.mediaTranscode));
    const origin = requestOrigin(request, config);
    const mediaByChapter = includeMedia
      ? await loadSignedMediaUrls(chapters, runtimeConfig, query, origin, mediaTranscode)
      : new Map();
    const bookWithCover = await withPreparedCoverUrl(book, origin, query);
    const feedXml = buildBookRss({
      request,
      config: runtimeConfig,
      query,
      origin,
      book: bookWithCover,
      chapters,
      mediaByChapter,
      total: numberValue(chaptersResult?.total, 0),
    });

    return {
      status: 200,
      headers: {
        "content-type": "application/rss+xml; charset=utf-8",
        "cache-control": cacheControlHeader(runtimeConfig.cacheMaxAgeSeconds),
      },
      body: feedXml,
    };
  } catch (error) {
    Ting?.log?.warn?.(`Book RSS feed generation failed: ${error}`);
    return errorResponse(error);
  }
}

async function generateCoverImage(request) {
  try {
    const query = parseQuery(request?.query || "");
    const bookId = firstText(request?.params?.book_id, "");
    if (!bookId) {
      throw new Error("Missing book_id");
    }
    if (query.link_id) {
      await requireActiveSavedLink(query, {
        book_id: bookId,
        path: `/rss/book/${bookId}/feed.xml`,
      });
    }

    const book = await hostInvoke("books.get", { book_id: bookId });
    const cover = firstText(book?.cover_url, "");
    if (!cover) {
      throw statusError(404, "Book cover is empty");
    }
    if (/^https?:\/\//i.test(cover)) {
      return {
        status: 302,
        headers: {
          location: cover,
          "cache-control": cacheControlHeader(DEFAULT_COVER_CACHE_MAX_AGE_SECONDS),
        },
        body: "",
      };
    }

    const image = await readLocalCoverImage(book, cover);
    return {
      status: 200,
      headers: {
        "content-type": image.content_type,
        "cache-control": cacheControlHeader(DEFAULT_COVER_CACHE_MAX_AGE_SECONDS),
      },
      body_base64: image.data_base64,
    };
  } catch (error) {
    Ting?.log?.warn?.(`Cover image generation failed: ${error}`);
    return errorResponse(error);
  }
}

async function redirectChapterMedia(request) {
  try {
    const config = readConfig();
    const query = parseQuery(request?.query || "");
    const chapterId = String(request?.params?.chapter_id || "");
    if (!chapterId) {
      throw new Error("Missing chapter_id");
    }

    const link = await requireActiveSavedLink(query);
    const chapter = await hostInvoke("chapters.get", { chapter_id: chapterId });
    if (link.book_id && chapter?.book_id !== link.book_id) {
      throw statusError(403, "RSS media link does not match this book.");
    }
    const transcode = normalizeMediaTranscode(firstText(query.transcode, link.transcode, config.mediaTranscode));
    const media = await hostInvoke("media.get_signed_url", compactObject({
      chapter_id: chapterId,
      expires_in_seconds: expiresSecondsFromDays(daysValue(query.media_expires_days, link.media_expires_days, config.mediaUrlExpiresDays)),
      transcode: transcode || undefined,
      download: false,
    }));
    const origin = requestOrigin(request, config);
    return {
      status: 302,
      headers: {
        location: absoluteUrl(origin, media.url),
        "cache-control": "no-store",
      },
      body: "",
    };
  } catch (error) {
    Ting?.log?.warn?.(`RSS media redirect failed: ${error}`);
    return errorResponse(error);
  }
}

async function loadFeedBooks(libraryId, query, limit, offset) {
  const pageSize = 200;
  const items = [];
  let total = 0;
  let currentOffset = offset;

  while (true) {
    const remaining = limit === null ? pageSize : limit - items.length;
    if (remaining <= 0) break;

    const result = await hostInvoke("books.list", compactObject({
      library_id: libraryId || undefined,
      search: firstText(query.search, query.q, ""),
      tag: firstText(query.tag, ""),
      limit: Math.min(pageSize, remaining),
      offset: currentOffset,
    }));
    const page = Array.isArray(result?.items) ? result.items : [];
    total = numberValue(result?.total, total || page.length);
    items.push(...page);
    currentOffset += page.length;

    if (!page.length || currentOffset >= total || page.length < Math.min(pageSize, remaining)) {
      break;
    }
  }

  return {
    items,
    total,
    offset,
    limit,
  };
}

async function loadBookChapters(bookId, limit, offset) {
  const pageSize = 500;
  const items = [];
  let total = 0;
  let currentOffset = offset;

  while (true) {
    const remaining = limit === null ? pageSize : limit - items.length;
    if (remaining <= 0) break;

    const result = await hostInvoke("chapters.list", {
      book_id: bookId,
      limit: Math.min(pageSize, remaining),
      offset: currentOffset,
    });
    const page = Array.isArray(result?.items) ? result.items : [];
    total = numberValue(result?.total, total || page.length);
    items.push(...page);
    currentOffset += page.length;

    if (!page.length || currentOffset >= total || page.length < Math.min(pageSize, remaining)) {
      break;
    }
  }

  return {
    items,
    total,
    offset,
    limit,
  };
}

async function loadSignedMediaUrls(chapters, config, query, origin, transcode) {
  const result = new Map();
  for (const chapter of chapters) {
    if (!chapter?.id) continue;
    try {
      const path = `/rss/media/${chapter.id}`;
      const signed = await hostInvoke("plugin_routes.sign", {
        method: "GET",
        path,
        expires_in_seconds: expiresSecondsFromDays(config.mediaUrlExpiresDays),
        bind_current_user: true,
      });
      const params = [];
      const linkId = firstText(query?.link_id, "");
      if (linkId) params.push(`link_id=${encodeURIComponent(linkId)}`);
      if (transcode) params.push(`transcode=${encodeURIComponent(transcode)}`);
      params.push(`media_expires_days=${encodeURIComponent(String(config.mediaUrlExpiresDays))}`);
      const url = absoluteUrl(origin, appendQuery(signed.signed_url, params.join("&")));
      result.set(chapter.id, {
        chapter_id: chapter.id,
        book_id: chapter.book_id,
        url,
        expires: signed.expires,
        content_type: signedMediaContentType(chapter?.path, transcode),
        length: chapter?.size || chapter?.file_size || 0,
      });
    } catch (error) {
      Ting?.log?.warn?.(`Failed to sign media URL for ${chapter.id}: ${error}`);
    }
  }
  return result;
}

async function loadChapterPreview(book, previewCount) {
  if (!book?.id || previewCount <= 0) {
    return { items: [], total: 0 };
  }

  try {
    const result = await hostInvoke("chapters.list", {
      book_id: book.id,
      limit: previewCount,
      offset: 0,
    });
    return {
      items: Array.isArray(result?.items) ? result.items : [],
      total: numberValue(result?.total, 0),
    };
  } catch (error) {
    Ting?.log?.warn?.(`Failed to load chapter preview for ${book.id}: ${error}`);
    return { items: [], total: 0, error: String(error) };
  }
}

function buildRss({ request, config, query, origin, library, libraryId, total, items }) {
  const libraryName = firstText(library?.name, library?.id, libraryId);
  const title = library
    ? `${DEFAULT_FEED_TITLE} - ${libraryName}`
    : DEFAULT_FEED_TITLE;
  const description = library
    ? `${DEFAULT_FEED_DESCRIPTION}：${libraryName}`
    : DEFAULT_FEED_DESCRIPTION;
  const homeLink = absoluteUrl(origin, "/");
  const selfLink = selfUrl(request, origin);
  const dates = items
    .map((item) => itemDate(item.book))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());
  const lastBuildDate = dates[0] || new Date();
  const language = firstText(query.lang, "zh-cn").toLowerCase();

  const channel = [
    xmlLine("title", title, 2),
    xmlLine("link", homeLink, 2),
    xmlLine("description", description, 2),
    xmlLine("language", language, 2),
    xmlLine("generator", PLUGIN_NAME, 2),
    xmlLine("lastBuildDate", toRfc822(lastBuildDate), 2),
    xmlLine("ttl", String(Math.max(1, Math.ceil(config.cacheMaxAgeSeconds / 60))), 2),
    `  <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />`,
    `  <docs>https://www.rssboard.org/rss-specification</docs>`,
    `  <category>${escapeXml(library ? "Ting Reader Library" : "Ting Reader")}</category>`,
    `  <itemCount>${escapeXml(String(total))}</itemCount>`,
    ...items.map((item) => buildItem(item, origin)),
  ].join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    rssRootOpen(),
    "<channel>",
    channel,
    "</channel>",
    "</rss>",
  ].join("\n");
}

function buildBookRss({ request, config, query, origin, book, chapters, mediaByChapter, total }) {
  const bookTitle = firstText(book?.title, book?.name, "未命名有声书");
  const author = firstText(book?.author, "");
  const narrator = firstText(book?.narrator, "");
  const channelTitle = bookTitle;
  const link = absoluteUrl(origin, `/book/${encodeURIComponent(book?.id || "")}`);
  const cover = absoluteCoverUrl(book, origin);
  const categories = bookCategoryXml(book, 2);
  const dates = chapters
    .map((chapter) => chapterDate(chapter, book))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());
  const lastBuildDate = dates[0] || itemDate(book) || new Date();
  const language = firstText(query.lang, "zh-cn").toLowerCase();
  const description = firstText(
    book?.description,
    [author ? `作者：${author}` : "", narrator ? `演播：${narrator}` : ""]
      .filter(Boolean)
      .join(" / "),
    `${bookTitle} 的章节 RSS`,
  );

  const channel = [
    xmlLine("title", channelTitle, 2),
    xmlLine("link", link, 2),
    xmlLine("description", description, 2),
    xmlLine("language", language, 2),
    author ? xmlLine("dc:creator", author, 2) : "",
    author ? xmlLine("itunes:author", author, 2) : "",
    narrator ? xmlLine("itunes:narrator", narrator, 2) : "",
    xmlLine("generator", PLUGIN_NAME, 2),
    xmlLine("lastBuildDate", toRfc822(lastBuildDate), 2),
    xmlLine("ttl", String(Math.max(1, Math.ceil(config.cacheMaxAgeSeconds / 60))), 2),
    `  <atom:link href="${escapeXml(selfUrl(request, origin))}" rel="self" type="application/rss+xml" />`,
    cover ? channelImageXml(channelTitle, link, cover) : "",
    categories,
    `  <itemCount>${escapeXml(String(total))}</itemCount>`,
    ...chapters.map((chapter, index) =>
      buildChapterItem(chapter, book, origin, index, mediaByChapter?.get(chapter.id)),
    ),
  ].filter(Boolean).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    rssRootOpen(),
    "<channel>",
    channel,
    "</channel>",
    "</rss>",
  ].join("\n");
}

function buildItem(item, origin) {
  const book = item.book || {};
  const title = firstText(book.title, book.name, "未命名有声书");
  const author = firstText(book.author, "");
  const narrator = firstText(book.narrator, "");
  const link = absoluteUrl(origin, `/book/${encodeURIComponent(book.id || "")}`);
  const date = itemDate(book) || new Date();
  const categories = normalizeTags(book.tags)
    .map((tag) => `    <category>${escapeXml(tag)}</category>`)
    .join("\n");
  const cover = absoluteCoverUrl(book, origin);
  const chapterSummary = chapterSummaryHtml(item.chapters);
  const textDescription = plainItemDescription(book, item.chapters);
  const htmlDescription = [
    book.description ? `<p>${escapeHtml(book.description)}</p>` : "",
    metadataListHtml(book, item.chapters),
    chapterSummary,
  ].filter(Boolean).join("");

  return [
    "  <item>",
    xmlLine("title", title, 4),
    xmlLine("link", link, 4),
    xmlLine("guid", `ting-reader:book:${book.id || title}`, 4, { isPermaLink: "false" }),
    xmlLine("pubDate", toRfc822(date), 4),
    xmlLine("description", textDescription, 4),
    author ? xmlLine("dc:creator", author, 4) : "",
    author ? xmlLine("itunes:author", author, 4) : "",
    narrator ? xmlLine("itunes:narrator", narrator, 4) : "",
    cover ? `    <media:thumbnail url="${escapeXml(cover)}" />` : "",
    categories,
    `    <content:encoded><![CDATA[${escapeCdata(htmlDescription || escapeHtml(textDescription))}]]></content:encoded>`,
    "  </item>",
  ].filter(Boolean).join("\n");
}

function buildChapterItem(chapter, book, origin, index, media) {
  const title = chapterDisplayTitle(chapter, index);
  const author = firstText(book?.author, "");
  const narrator = firstText(book?.narrator, "");
  const link = absoluteUrl(
    origin,
    `/book/${encodeURIComponent(book?.id || chapter?.book_id || "")}?chapter_id=${encodeURIComponent(chapter?.id || "")}`,
  );
  const date = chapterDate(chapter, book) || new Date();
  const duration = durationText(chapter?.duration);
  const description = chapterPlainDescription(book, chapter);
  const htmlDescription = chapterHtmlDescription(book, chapter);
  const enclosureUrl = media?.url ? absoluteUrl(origin, media.url) : "";
  const enclosureType = firstText(media?.content_type, "audio/mpeg");
  const enclosureLength = String(Math.max(0, Math.round(Number(media?.length || 0))));
  const categories = bookCategoryXml(book, 4);

  return [
    "  <item>",
    xmlLine("title", title, 4),
    xmlLine("link", link, 4),
    xmlLine("guid", `ting-reader:chapter:${chapter?.id || `${book?.id || ""}:${index}`}`, 4, { isPermaLink: "false" }),
    xmlLine("pubDate", toRfc822(date), 4),
    xmlLine("description", description, 4),
    author ? xmlLine("dc:creator", author, 4) : "",
    author ? xmlLine("itunes:author", author, 4) : "",
    narrator ? xmlLine("itunes:narrator", narrator, 4) : "",
    duration ? xmlLine("itunes:duration", duration, 4) : "",
    enclosureUrl
      ? `    <enclosure url="${escapeXml(enclosureUrl)}" length="${escapeXml(enclosureLength)}" type="${escapeXml(enclosureType)}" />`
      : "",
    categories,
    Number.isFinite(Number(chapter?.chapter_index))
      ? xmlLine("itunes:episode", String(chapter.chapter_index), 4)
      : "",
    `    <content:encoded><![CDATA[${escapeCdata(htmlDescription)}]]></content:encoded>`,
    "  </item>",
  ].filter(Boolean).join("\n");
}

function bookCategoryXml(book, indent) {
  const tags = normalizeTags(book?.tags);
  if (book?.genre) tags.push(...normalizeTags(book.genre));
  const unique = Array.from(new Set(tags.map((tag) => String(tag).trim()).filter(Boolean)));
  return unique
    .map((tag) => `${" ".repeat(indent)}<category>${escapeXml(tag)}</category>`)
    .join("\n");
}

function metadataListHtml(book, chapters) {
  const rows = [
    ["作者", book.author],
    ["演播", book.narrator],
    ["类型", book.genre],
    ["年份", book.year],
    ["章节数", chapters ? chapters.total : null],
  ]
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);

  return rows.length ? `<dl>${rows.join("")}</dl>` : "";
}

function chapterSummaryHtml(chapters) {
  const items = Array.isArray(chapters?.items) ? chapters.items : [];
  if (!items.length) return "";
  const listItems = items.map((chapter) => {
    const title = firstText(chapter.title, `第 ${chapter.chapter_index || ""} 章`);
    const duration = durationText(chapter.duration);
    return `<li>${escapeHtml(title)}${duration ? ` <small>${escapeHtml(duration)}</small>` : ""}</li>`;
  });
  return `<p>章节预览：</p><ol>${listItems.join("")}</ol>`;
}

function plainItemDescription(book, chapters) {
  const lines = [];
  if (book.description) lines.push(String(book.description).trim());
  const meta = [];
  if (book.author) meta.push(`作者：${book.author}`);
  if (book.narrator) meta.push(`演播：${book.narrator}`);
  if (book.genre) meta.push(`类型：${book.genre}`);
  if (chapters && Number.isFinite(chapters.total)) meta.push(`章节：${chapters.total}`);
  if (meta.length) lines.push(meta.join(" / "));

  const preview = Array.isArray(chapters?.items)
    ? chapters.items.map((chapter) => firstText(chapter.title, "")).filter(Boolean)
    : [];
  if (preview.length) lines.push(`章节预览：${preview.join("、")}`);
  return lines.join("\n\n") || firstText(book.title, "Ting Reader 馆藏条目");
}

function chapterPlainDescription(book, chapter) {
  const lines = [];
  const bookTitle = firstText(book?.title, "未命名有声书");
  const meta = [`书籍：${bookTitle}`];
  if (book?.author) meta.push(`作者：${book.author}`);
  if (book?.narrator) meta.push(`演播：${book.narrator}`);
  const duration = durationText(chapter?.duration);
  if (duration) meta.push(`时长：${duration}`);
  lines.push(meta.join(" / "));
  if (book?.description) lines.push(String(book.description).trim());
  return lines.join("\n\n");
}

function chapterHtmlDescription(book, chapter) {
  const title = chapterDisplayTitle(chapter, 0);
  const rows = [
    ["书籍", firstText(book?.title, "")],
    ["作者", book?.author],
    ["演播", book?.narrator],
    ["章节序号", chapter?.chapter_index],
    ["时长", durationText(chapter?.duration)],
  ]
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);
  const description = book?.description ? `<p>${escapeHtml(book.description)}</p>` : "";
  return `<h2>${escapeHtml(title)}</h2>${rows.length ? `<dl>${rows.join("")}</dl>` : ""}${description}`;
}

async function withPreparedCoverUrl(book, origin, query) {
  if (!book || typeof book !== "object") return book;
  const next = Object.assign({}, book);
  next._rss_cover_url = await signedOrAbsoluteCoverUrl(book, origin, query || {});
  return next;
}

async function signedOrAbsoluteCoverUrl(book, origin, query) {
  const cover = firstText(book?.cover_url, "");
  if (!cover) return "";
  if (/^https?:\/\//i.test(cover)) return cover;
  if (cover.startsWith("/api/") || cover.startsWith("/assets/") || cover.startsWith("/static/")) {
    return absoluteUrl(origin, cover);
  }
  if (!book?.id) return "";

  try {
    const path = `/rss/cover/${book.id}`;
    const signed = await hostInvoke("plugin_routes.sign", {
      method: "GET",
      path,
      expires_in_seconds: expiresSecondsFromDays(daysValue(query?.media_expires_days, DEFAULT_MEDIA_URL_EXPIRES_DAYS, 365)),
      bind_current_user: true,
    });
    const params = [];
    const linkId = firstText(query?.link_id, "");
    if (linkId) params.push(`link_id=${encodeURIComponent(linkId)}`);
    const signedUrl = appendQuery(signed.signed_url, params.join("&"));
    return absoluteUrl(origin, signedUrl);
  } catch (error) {
    Ting?.log?.warn?.(`Failed to sign cover route for ${book.id}: ${error}`);
    return "";
  }
}

function absoluteCoverUrl(book, origin) {
  const prepared = firstText(book?._rss_cover_url, "");
  if (prepared) return prepared;
  const cover = firstText(book?.cover_url, "");
  if (!cover) return "";
  if (/^https?:\/\//i.test(cover)) return cover;
  if (cover.startsWith("/api/") || cover.startsWith("/assets/") || cover.startsWith("/static/")) {
    return absoluteUrl(origin, cover);
  }
  return "";
}

async function readLocalCoverImage(book, cover) {
  const libraryId = firstText(book?.library_id, "");
  if (!libraryId) {
    throw statusError(404, "Book has no library_id for local cover");
  }
  const library = await hostInvoke("libraries.get", { library_id: libraryId });
  const bookCandidates = coverBookPathCandidates(cover, book);
  const isLocalLibrary = firstText(library?.type, "").toLowerCase() === "local";
  const candidates = isLocalLibrary ? [] : coverPathCandidates(cover, book, library);
  let lastError = null;

  for (const path of bookCandidates) {
    try {
      const file = await hostInvoke("library.file.open", {
        library_id: libraryId,
        book_id: firstText(book?.id, ""),
        relative_to: "book",
        path,
      });
      return {
        path,
        data_base64: encodeBase64(await readResource(file.resource, file.length)),
        content_type: contentTypeFromPath(path),
      };
    } catch (error) {
      lastError = error;
    }
  }

  for (const path of candidates) {
    try {
      const file = await hostInvoke("library.file.open", {
        library_id: libraryId,
        path,
      });
      return {
        path,
        data_base64: encodeBase64(await readResource(file.resource, file.length)),
        content_type: contentTypeFromPath(path),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw statusError(
    404,
    `Cover image not found: ${cover}; tried book:${bookCandidates.join(", ") || "(none)"}; library:${candidates.join(", ") || "(none)"}; last error: ${lastError?.message || "none"}`,
  );
}

function coverBookPathCandidates(cover, book) {
  const candidates = [];
  const raw = normalizeFilePathText(cover);
  const withoutDot = raw.replace(/^\.\//, "");
  const bookPath = normalizeFilePathText(book?.path || "");
  const bookBase = pathBasename(bookPath);

  if (bookBase) {
    addCandidate(candidates, stripThroughPathSegment(withoutDot, bookBase));
  }
  if (!withoutDot.includes("/")) {
    addCandidate(candidates, withoutDot);
  }
  return candidates;
}

function coverPathCandidates(cover, book, library) {
  const candidates = [];
  const raw = normalizeFilePathText(cover);
  const withoutDot = raw.replace(/^\.\//, "");
  const libraryRoot = normalizeFilePathText(library?.root_path || "");
  const libraryBase = pathBasename(libraryRoot);
  const bookPath = normalizeFilePathText(book?.path || "");
  const bookRelative = relativeToRoot(bookPath, libraryRoot);

  addCandidate(candidates, raw);
  addCandidate(candidates, withoutDot);
  addCandidate(candidates, stripFileUrl(withoutDot));

  const fromLibraryRoot = relativeToRoot(withoutDot, libraryRoot);
  if (fromLibraryRoot) addCandidate(candidates, fromLibraryRoot);

  if (libraryBase && startsWithPathSegment(withoutDot, libraryBase)) {
    addCandidate(candidates, withoutDot.slice(libraryBase.length).replace(/^\/+/, ""));
  }
  if (libraryBase) {
    addCandidate(candidates, stripThroughPathSegment(withoutDot, libraryBase));
  }

  if (bookRelative) {
    const basenameOnly = !withoutDot.includes("/");
    if (basenameOnly) addCandidate(candidates, `${bookRelative}/${withoutDot}`);
    const bookBase = pathBasename(bookRelative);
    if (bookBase && startsWithPathSegment(withoutDot, bookBase)) {
      addCandidate(candidates, withoutDot);
    }
    if (bookBase) {
      addCandidate(candidates, stripThroughPathSegment(withoutDot, bookBase));
    }
  } else {
    const bookBase = pathBasename(bookPath);
    if (bookBase) {
      addCandidate(candidates, stripThroughPathSegment(withoutDot, bookBase));
    }
  }

  return candidates;
}

function addCandidate(candidates, value) {
  const normalized = normalizeRelativeCoverPath(value);
  if (normalized && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function normalizeRelativeCoverPath(value) {
  const text = stripFileUrl(normalizeFilePathText(value)).replace(/^\.\//, "");
  if (!text || /^[a-zA-Z]:\//.test(text) || text.startsWith("/")) return "";
  return text;
}

function normalizeFilePathText(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function stripFileUrl(value) {
  return String(value || "").replace(/^file:\/+/i, "");
}

function relativeToRoot(value, root) {
  const normalizedValue = normalizeFilePathText(value);
  const normalizedRoot = normalizeFilePathText(root).replace(/\/+$/, "");
  if (!normalizedValue || !normalizedRoot) return "";
  const lowerValue = normalizedValue.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  if (!lowerValue.startsWith(lowerRoot.toLowerCase())) return "";
  return normalizedValue.slice(normalizedRoot.length).replace(/^\/+/, "");
}

function startsWithPathSegment(path, segment) {
  const normalizedPath = normalizeFilePathText(path).toLowerCase();
  const normalizedSegment = normalizeFilePathText(segment).toLowerCase().replace(/^\/+|\/+$/g, "");
  return normalizedPath === normalizedSegment || normalizedPath.startsWith(`${normalizedSegment}/`);
}

function stripThroughPathSegment(path, segment) {
  const parts = normalizeFilePathText(path).split("/").filter(Boolean);
  const target = normalizeFilePathText(segment).toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!target) return "";
  const index = parts.findIndex((part) => part.toLowerCase() === target);
  if (index < 0 || index >= parts.length - 1) return "";
  return parts.slice(index + 1).join("/");
}

function pathBasename(path) {
  const parts = normalizeFilePathText(path).replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || "";
}

function contentTypeFromPath(path) {
  const ext = String(path || "").split("?")[0].split(".").pop().toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function signedMediaContentType(path, transcode) {
  if (transcode === "mp3") return "audio/mpeg";
  if (transcode === "wav") return "audio/wav";
  if (transcode === "hls") return "application/vnd.apple.mpegurl";
  return contentTypeFromPath(path).replace(/^application\/octet-stream$/, "audio/mpeg");
}

function itemDate(book) {
  return parseDate(firstText(book?.created_at, book?.updated_at, ""));
}

function chapterDate(chapter, book) {
  return parseDate(firstText(chapter?.created_at, "")) || itemDate(book);
}

function chapterDisplayTitle(chapter, index) {
  return firstText(
    chapter?.title,
    Number.isFinite(Number(chapter?.chapter_index)) ? `第 ${chapter.chapter_index} 章` : "",
    `第 ${index + 1} 章`,
  );
}

function channelImageXml(title, link, url) {
  return [
    "  <image>",
    xmlLine("url", url, 4),
    xmlLine("title", title, 4),
    xmlLine("link", link, 4),
    "  </image>",
    `  <itunes:image href="${escapeXml(url)}" />`,
  ].join("\n");
}

function rssRootOpen() {
  return '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/">';
}

function selfUrl(request, origin) {
  const access = firstText(request?.context?.access, "");
  const prefix = access === "signed" || access === "public"
    ? "/api/v1/public/plugin-routes"
    : "/api/v1/plugin-routes";
  const path = firstText(request?.path, "/rss/library/all/feed.xml");
  const query = firstText(request?.query, "");
  return absoluteUrl(origin, `${prefix}${path}${query ? `?${query}` : ""}`);
}

function requestOrigin(request, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const headers = request?.headers || {};
  const forwardedHost = firstHeader(headers, "x-forwarded-host");
  const host = firstText(forwardedHost, firstHeader(headers, "host"));
  if (!host) return "";
  const forwardedProto = firstHeader(headers, "x-forwarded-proto");
  const proto = firstText(forwardedProto, firstHeader(headers, "x-forwarded-protocol"), "http")
    .split(",")[0]
    .trim();
  return `${proto}://${host.split(",")[0].trim()}`.replace(/\/+$/, "");
}

function absoluteUrl(origin, path) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return origin ? `${origin}${normalizedPath}` : normalizedPath;
}

function appendQuery(url, query) {
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

async function hostInvoke(method, params) {
  if (!Ting?.host?.invoke) {
    throw new Error("Ting.host.invoke is not available in this runtime");
  }
  return await Ting.host.invoke(method, params || {});
}

async function loadSavedLinks() {
  const records = await loadSavedLinkRecords();
  return visibleSavedLinks(records);
}

async function loadSavedLinkRecords() {
  try {
    const cached = await hostInvoke("cache.get", { key: SAVED_LINKS_CACHE_KEY });
    const value = Array.isArray(cached?.value) ? cached.value : [];
    return value
      .map(compactSavedLink)
      .filter((link) => link.id && link.path)
      .slice(0, MAX_SAVED_LINK_RECORDS);
  } catch (error) {
    Ting?.log?.warn?.(`Failed to load saved RSS links: ${error}`);
    return [];
  }
}

async function saveSavedLink(entry) {
  const current = await loadSavedLinkRecords();
  const normalized = compactSavedLink(entry);
  const next = [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, MAX_SAVED_LINK_RECORDS);

  await saveSavedLinkRecords(next);
  return visibleSavedLinks(next);
}

async function saveSavedLinkRecords(records) {
  const compacted = records
    .map(compactSavedLink)
    .filter((link) => link.id && link.path)
    .slice(0, MAX_SAVED_LINK_RECORDS);

  try {
    await hostInvoke("cache.set", {
      key: SAVED_LINKS_CACHE_KEY,
      value: compacted,
    });
  } catch (error) {
    Ting?.log?.warn?.(`Failed to save RSS links: ${error}`);
  }

  return compacted;
}

function visibleSavedLinks(records) {
  return (records || [])
    .filter((link) => !link.deleted && link.url)
    .slice(0, MAX_VISIBLE_SAVED_LINKS);
}

async function setSavedLinkEnabled(input, enabled) {
  const linkId = requiredLinkId(input);
  const records = await loadSavedLinkRecords();
  let updated = null;
  const next = records.map((link) => {
    if (link.id !== linkId || link.deleted) return link;
    updated = compactSavedLink({
      ...link,
      enabled,
      updated_at: new Date().toISOString(),
    });
    return updated;
  });

  if (!updated) {
    throw new Error("RSS link not found");
  }

  const saved = await saveSavedLinkRecords(next);
  return {
    ok: true,
    link: updated,
    saved_links: visibleSavedLinks(saved),
  };
}

async function deleteSavedLink(input) {
  const linkId = requiredLinkId(input);
  const records = await loadSavedLinkRecords();
  let deleted = null;
  const next = records.map((link) => {
    if (link.id !== linkId || link.deleted) return link;
    deleted = compactSavedLink({
      ...link,
      enabled: false,
      deleted: true,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return deleted;
  });

  if (!deleted) {
    throw new Error("RSS link not found");
  }

  const saved = await saveSavedLinkRecords(next);
  return {
    ok: true,
    deleted: true,
    link: deleted,
    saved_links: visibleSavedLinks(saved),
  };
}

async function requireActiveSavedLink(query, expected) {
  const linkId = firstText(query?.link_id, query?.link, "");
  if (!linkId) {
    throw statusError(410, "RSS link is no longer valid. Please regenerate it.");
  }

  const records = await loadSavedLinkRecords();
  const link = records.find((item) => item.id === linkId);
  if (!link || link.deleted) {
    throw statusError(410, "RSS link has been deleted. Please regenerate it.");
  }
  if (link.enabled === false) {
    throw statusError(403, "RSS link is disabled.");
  }
  if (expected?.path && normalizeRoutePath(link.path) !== normalizeRoutePath(expected.path)) {
    throw statusError(403, "RSS link does not match this route.");
  }
  if (expected?.book_id && link.book_id !== expected.book_id) {
    throw statusError(403, "RSS link does not match this book.");
  }

  return link;
}

function requiredLinkId(input) {
  const linkId = firstText(input?.link_id, input?.id, "");
  if (!linkId) {
    throw new Error("link_id is required");
  }
  return linkId;
}

function createLinkId() {
  if (globalThis.crypto?.randomUUID) {
    return `rss_${globalThis.crypto.randomUUID()}`;
  }
  return `rss_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeRoutePath(path) {
  return String(path || "")
    .trim()
    .replace(/^\/api\/v1\/public\/plugin-routes/i, "")
    .replace(/^\/api\/public\/plugin-routes/i, "")
    .replace(/^\/api\/v1\/plugin-routes/i, "")
    .replace(/^\/api\/plugin-routes/i, "");
}

function readConfig() {
  const config = Ting?.config || {};
  return {
    publicBaseUrl: normalizeBaseUrl(stringValue(config.public_base_url, "")),
    rssLinkExpiresDays: DEFAULT_RSS_LINK_EXPIRES_DAYS,
    mediaUrlExpiresDays: DEFAULT_MEDIA_URL_EXPIRES_DAYS,
    mediaTranscode: DEFAULT_MEDIA_TRANSCODE,
    includeChapterOutline: true,
    chapterPreviewCount: 3,
    cacheMaxAgeSeconds: DEFAULT_CACHE_MAX_AGE_SECONDS,
  };
}

function publicConfig(config, fallbackOrigin) {
  const actual = config || readConfig();
  return {
    public_base_url: firstText(actual.publicBaseUrl, normalizeBaseUrl(fallbackOrigin), ""),
    rss_link_expires_days: actual.rssLinkExpiresDays,
    media_url_expires_days: actual.mediaUrlExpiresDays,
    media_transcode: actual.mediaTranscode || "original",
    cache_max_age_seconds: actual.cacheMaxAgeSeconds,
  };
}

function compactBook(book) {
  return {
    id: firstText(book?.id, book?.book_id, ""),
    title: firstText(book?.title, book?.name, "未命名有声书"),
    author: firstText(book?.author, ""),
    narrator: firstText(book?.narrator, ""),
    cover_url: firstText(book?.cover_url, ""),
    library_id: firstText(book?.library_id, ""),
    created_at: firstText(book?.created_at, ""),
  };
}

function compactSavedLink(link) {
  return {
    id: firstText(link?.id, ""),
    book_id: firstText(link?.book_id, ""),
    title: firstText(link?.title, "未命名有声书"),
    author: firstText(link?.author, ""),
    narrator: firstText(link?.narrator, ""),
    url: firstText(link?.url, ""),
    signed_url: firstText(link?.signed_url, ""),
    path: firstText(link?.path, ""),
    expires: numberValue(link?.expires, 0),
    expires_days: daysValue(link?.expires_days, DEFAULT_RSS_LINK_EXPIRES_DAYS, 30),
    media_expires_days: daysValue(link?.media_expires_days, DEFAULT_MEDIA_URL_EXPIRES_DAYS, 365),
    chapter_limit: optionalIntegerValue(link?.chapter_limit, null, 1, 1000000),
    cache_seconds: integerValue(link?.cache_seconds, DEFAULT_CACHE_MAX_AGE_SECONDS, 0, 86400),
    media: link?.media !== false,
    transcode: firstText(link?.transcode, "original"),
    enabled: link?.enabled !== false,
    deleted: link?.deleted === true,
    created_at: firstText(link?.created_at, ""),
    updated_at: firstText(link?.updated_at, ""),
    deleted_at: firstText(link?.deleted_at, ""),
  };
}

function errorResponse(error) {
  const message = String(error?.message || error || "RSS feed generation failed");
  const explicitStatus = Number(error?.status);
  const status = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
    ? explicitStatus
    : /PermissionDenied|permission denied|cannot access/i.test(message)
      ? 403
      : /NotFound|not found/i.test(message)
        ? 404
        : 500;
  return {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `${PLUGIN_NAME}: ${message}`,
  };
}

function cacheControlHeader(seconds) {
  if (!seconds) return "no-store";
  return `public, max-age=${seconds}`;
}

function parseQuery(query) {
  const result = {};
  const text = String(query || "").replace(/^\?/, "");
  if (!text) return result;
  for (const part of text.split("&")) {
    if (!part) continue;
    const index = part.indexOf("=");
    const rawKey = index >= 0 ? part.slice(0, index) : part;
    const rawValue = index >= 0 ? part.slice(index + 1) : "";
    const key = decodeQueryPart(rawKey);
    if (!key || key === "signature" || key === "expires" || key === "user") continue;
    result[key] = decodeQueryPart(rawValue);
  }
  return result;
}

function decodeQueryPart(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, " "));
  } catch (_) {
    return String(value || "");
  }
}

function booleanQuery(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
  }
  return String(value || "")
    .split(/[，,;；|/]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function compactObject(value) {
  const output = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry !== undefined && entry !== null && entry !== "") output[key] = entry;
  }
  return output;
}

function xmlLine(name, value, indent, attrs) {
  const attrText = attrs
    ? Object.entries(attrs)
        .map(([key, entry]) => ` ${key}="${escapeXml(entry)}"`)
        .join("")
    : "";
  return `${" ".repeat(indent)}<${name}${attrText}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

function escapeCdata(value) {
  return String(value ?? "").replaceAll("]]>", "]]]]><![CDATA[>");
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? text.replace(" ", "T") + "Z"
    : text;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toRfc822(date) {
  const actual = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date();
  return actual.toUTCString();
}

function durationText(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function firstHeader(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === lower) return String(value || "");
  }
  return "";
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function stringValue(value, fallback) {
  const text = firstText(value, "");
  return text || fallback;
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerValue(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function optionalIntegerValue(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function daysValue(value, fallback, max) {
  if (value === 0 || value === "0" || value === "permanent") return 0;
  return integerValue(value, fallback, 1, max);
}

function expiresSecondsFromDays(days) {
  return days === 0 ? 0 : days * 24 * 60 * 60;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeMediaTranscode(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "original") return "";
  if (text === "mp3" || text === "wav") return text;
  return "mp3";
}

export async function open(params) {
  return success(await openRssPanel(params));
}
export async function invokeToolSdk(params) {
  return success(await invokeTool(params));
}
export { invokeToolSdk as invokeTool };
export async function handle(request) {
  return success(await routeHandler(request));
}
async function routeHandler(request) {
  switch (request?.capability_id) {
    case "rss.feed": return generateRssFeed(request);
    case "rss.book": return generateBookRssFeed(request);
    case "rss.cover": return generateCoverImage(request);
    case "rss.media": return redirectChapterMedia(request);
    default: throw new Error("Undeclared RSS route");
  }
}
