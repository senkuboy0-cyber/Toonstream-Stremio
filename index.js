const { addonBuilder } = require("stremio-addon-sdk");
const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const ADDON_ID = "com.toonstream.stremio";
const DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";

let cachedMainUrl = "https://toon-stream.site";

async function getMainUrl() {
  if (cachedMainUrl && cachedMainUrl !== "https://toon-stream.site") {
    return cachedMainUrl;
  }
  try {
    const response = await fetch(DOMAINS_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (response.ok) {
      const data = await response.json();
      if (data.toonstream) {
        cachedMainUrl = data.toonstream;
        return cachedMainUrl;
      }
    }
  } catch (e) {
    console.error("Failed to fetch domains:", e.message);
  }
  return cachedMainUrl;
}

const manifest = {
  id: ADDON_ID,
  version: "1.0.0",
  name: "Toonstream",
  description: "Stream anime, cartoons and movies with Hindi dub support",
  logo: "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/Icons/toonstream.png",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "toonstream-movies",
      name: "Anime Movies",
      extra: [{ name: "search", isRequired: false }],
    },
    {
      type: "movie",
      id: "toonstream-cartoons",
      name: "Cartoons",
      extra: [{ name: "search", isRequired: false }],
    },
    {
      type: "series",
      id: "toonstream-anime",
      name: "Anime Series",
      extra: [{ name: "search", isRequired: false }],
    },
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};

const builder = new addonBuilder(manifest);

async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        ...options.headers,
      },
      ...options,
    });
    if (!response.ok) {
      console.error(`HTTP ${response.status} for ${url}`);
      return null;
    }
    return await response.text();
  } catch (e) {
    console.error(`Fetch error for ${url}:`, e.message);
    return null;
  }
}

function safeParse(html, selector) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const results = [];
  $(selector).each((i, el) => {
    try {
      results.push(el);
    } catch (e) {
      console.error("Parse error:", e.message);
    }
  });
  return results;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const metas = [];
  try {
    const mainUrl = await getMainUrl();
    let url = `${mainUrl}/`;
    if (id === "toonstream-movies") {
      url = `${mainUrl}/category/anime-movies/`;
    } else if (id === "toonstream-cartoons") {
      url = `${mainUrl}/category/animation-&-cartoon-movie/`;
    } else if (id === "toonstream-anime") {
      url = `${mainUrl}/category/anime-series/`;
    }
    if (extra?.search) {
      url = `${mainUrl}/page/1/?s=${encodeURIComponent(extra.search)}`;
    }
    const html = await safeFetch(url);
    if (!html) return { metas };
    const $ = cheerio.load(html);
    $("#movies-a ul > li").each((i, el) => {
      try {
        const title = $(el).find("article > header > h2, article h2.entry-title").text()?.trim()?.replace("Watch Online", "")?.trim();
        const href = $(el).find("article > a.lnk-blk, article a.lnk-blk").attr("href");
        let posterRaw = $(el).find("article img").attr("src");
        let poster = null;
        if (posterRaw) {
          if (posterRaw.startsWith("http")) poster = posterRaw;
          else if (posterRaw.startsWith("//")) poster = `https:${posterRaw}`;
        }
        if (title && href) {
          metas.push({
            id: href,
            type: type,
            name: title,
            poster: poster || "https://via.placeholder.com/150x225?text=" + encodeURIComponent(title),
            background: poster || "https://via.placeholder.com/1200x675?text=" + encodeURIComponent(title),
            posterShape: "portrait",
          });
        }
      } catch (e) {
        console.error("Error parsing catalog item:", e.message);
      }
    });
  } catch (error) {
    console.error("Catalog handler error:", error.message);
  }
  return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const mainUrl = await getMainUrl();
    const html = await safeFetch(id);
    if (!html) return { meta: {} };
    const $ = cheerio.load(html);
    const title = $("header.entry-header > h1")?.text()?.trim().replace("Watch Online", "");
    let posterRaw = $("div.bghd > img").attr("src");
    let poster = null;
    if (posterRaw) {
      if (posterRaw.startsWith("http")) poster = posterRaw;
      else poster = `https:${posterRaw}`;
    }
    const description = $("div.description > p")?.text()?.trim();
    if (type === "series") {
      const videos = [];
      const seasonElements = $("a.season-btn");
      for (let i = 0; i < seasonElements.length; i++) {
        const seasonNum = $(seasonElements[i]).attr("data-season");
        const postId = $(seasonElements[i]).attr("data-post");
        try {
          const seasonHtml = await safeFetch(
            `${mainUrl}/wp-admin/admin-ajax.php`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",
              },
              body: `action=action_select_season&season=${seasonNum}&post=${postId}`,
            }
          );
          if (!seasonHtml) continue;
          const $season = cheerio.load(seasonHtml);
          $season("article.post.episodes, article.post").each((j, ep) => {
            try {
              const epHref = $season(ep).find("a.lnk-blk, a").attr("href");
              const epName = $season(ep).find("h5.entry-title1, h2.entry-title, h3.entry-title")?.text()?.trim();
              if (epHref && epName) {
                videos.push({
                  id: epHref,
                  title: epName,
                  season: parseInt(seasonNum) || 1,
                  episode: videos.filter((v) => v.season === (parseInt(seasonNum) || 1)).length + 1,
                });
              }
            } catch (e) {
              console.error("Error parsing episode:", e.message);
            }
          });
        } catch (err) {
          console.error(`Error fetching season ${seasonNum}:`, err.message);
        }
      }
      return {
        meta: {
          id: id,
          type: type,
          name: title,
          poster: poster,
          background: poster,
          description: description,
          videos: videos.length > 0 ? videos : undefined,
        },
      };
    } else {
      return {
        meta: {
          id: id,
          type: type,
          name: title,
          poster: poster,
          background: poster,
          description: description,
        },
      };
    }
  } catch (error) {
    console.error("Meta handler error:", error.message);
    return { meta: {} };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  const streams = [];
  try {
    const mainUrl = await getMainUrl();
    const html = await safeFetch(id);
    if (!html) return { streams };
    const $ = cheerio.load(html);
    const servers = [];
    $("#aa-options > div > iframe").each((i, iframe) => {
      try {
        let rawSrc = $(iframe).attr("data-src");
        if (!rawSrc) rawSrc = $(iframe).attr("src");
        if (rawSrc) {
          const serverlink = rawSrc.startsWith("http") ? rawSrc : `${mainUrl}${rawSrc}`;
          servers.push(serverlink);
        }
      } catch (e) {
        console.error("Error parsing iframe:", e.message);
      }
    });
    for (const server of servers) {
      try {
        const serverHtml = await safeFetch(server);
        if (!serverHtml) continue;
        const $server = cheerio.load(serverHtml);
        const videoIframe = $server(".Video iframe, div.Video iframe, iframe[src]");
        if (videoIframe.length > 0) {
          const truelink = videoIframe.first().attr("src");
          if (truelink) {
            let serverName = "Toonstream";
            if (truelink.includes("as-cdn21.top")) serverName = "Zephyrflick 1080p";
            else if (truelink.includes("emturbovid.com")) serverName = "EmTurboVid 1080p";
            else if (truelink.includes("gdmirrorbot.nl")) serverName = "GDMirrorbot HD";
            else if (truelink.includes("rubystm.com")) serverName = "Streamruby";
            else if (truelink.includes("vidmoly.net")) serverName = "VidMoly";
            streams.push({
              url: truelink,
              title: serverName,
              quality: "1080p",
            });
          }
        }
      } catch (err) {
        console.error(`Error processing server ${server}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Stream handler error:", error.message);
  }
  return { streams };
});

const addon = builder.getInterface();

const app = express();
app.use(express.json());

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    const result = await addon.handlers.catalog(
      { type: req.params.type, id: req.params.id, extra: req.query },
      {}
    );
    res.json(result);
  } catch (err) {
    console.error("Catalog route error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const result = await addon.handlers.meta(
      { type: req.params.type, id: req.params.id },
      {}
    );
    res.json(result);
  } catch (err) {
    console.error("Meta route error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const result = await addon.handlers.stream(
      { type: req.params.type, id: req.params.id },
      {}
    );
    res.json(result);
  } catch (err) {
    console.error("Stream route error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/", (req, res) => {
  res.json({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    status: "running",
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Toonstream Stremio addon listening on port ${PORT}`);
  console.log(`Manifest available at http://localhost:${PORT}/manifest.json`);
});

module.exports = addon;
