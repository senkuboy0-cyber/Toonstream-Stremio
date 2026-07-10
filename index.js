const { addonBuilder } = require("stremio-addon-sdk");
const express = require("express");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const ADDON_ID = "com.toonstream.stremio";
const MAIN_URL = "https://toon-stream.site";

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
    configurable: false,
  },
};

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

// ─── Zephyrflick / AsCdn21 extractor ─────────────────────────────
// POST /player/index.php?data={hash}&do=getVideo -> { videoSource: "m3u8..." }
async function extractZephyrflick(url) {
  try {
    const hash = url.substringAfterLast("/");
    const apiUrl = `https://as-cdn21.top/player/index.php?data=${hash}&do=getVideo`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `hash=${hash}&r=https://as-cdn21.top`,
    });

    if (!response.ok) return null;
    
    const data = await response.json();
    const m3u8 = data?.videoSource;
    
    if (m3u8 && m3u8.includes(".m3u8")) {
      return m3u8;
    }
  } catch (e) {
    console.error("Zephyrflick extractor error:", e.message);
  }
  return null;
}

// ─── EmTurboVid extractor ────────────────────────────────────────
// Looks for #video_player[data-hash] attribute containing m3u8
async function extractEmTurboVid(url) {
  try {
    const html = await safeFetch(url);
    if (!html) return null;
    
    const $ = cheerio.load(html);
    const dataHash = $("#video_player[data-hash]").attr("data-hash");
    
    if (dataHash && dataHash.includes(".m3u8")) {
      return dataHash;
    }
  } catch (e) {
    console.error("EmTurboVid extractor error:", e.message);
  }
  return null;
}

// ─── Streamruby extractor ────────────────────────────────────────
// Looks for "file": "https://...m3u8..." pattern in page source
async function extractStreamruby(url) {
  try {
    const newUrl = url.includes("/e/") ? url.replace("/e/", "/") : url;
    const html = await safeFetch(newUrl);
    if (!html) return null;
    
    // Try multiple patterns
    const patterns = [
      /["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
      /(https?:\/\/[^\s"'>]+\.m3u8[^\s"'>]*)/gi,
    ];
    
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch (e) {
    console.error("Streamruby extractor error:", e.message);
  }
  return null;
}

// ─── VidMolyNet extractor ────────────────────────────────────────
// Looks for jwplayer file key or raw m3u8 URL
async function extractVidMolyNet(url) {
  try {
    const html = await safeFetch(url);
    if (!html) return null;
    
    // Try jwplayer pattern first
    const jwPattern = /["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
    const jwMatch = jwPattern.exec(html);
    if (jwMatch && jwMatch[1]) {
      return jwMatch[1];
    }
    
    // Fallback: raw m3u8 URL
    const rawPattern = /(https?:\/\/[^\s"'>]+\.m3u8[^\s"'>]*)/gi;
    const rawMatch = rawPattern.exec(html);
    if (rawMatch && rawMatch[1]) {
      return rawMatch[1];
    }
  } catch (e) {
    console.error("VidMolyNet extractor error:", e.message);
  }
  return null;
}

// ─── GDMirrorbot extractor ───────────────────────────────────────
async function extractGDMirrorbot(url) {
  try {
    // Simple version - fetch and look for video URLs
    const html = await safeFetch(url);
    if (!html) return null;
    
    const $ = cheerio.load(html);
    
    // Look for video sources
    const videoSrc = $("video source, source[type*='video']").attr("src");
    if (videoSrc) {
      return videoSrc.startsWith("http") ? videoSrc : `${MAIN_URL}${videoSrc}`;
    }
    
    // Look for m3u8 in page
    const m3u8Pattern = /(https?:\/\/[^\s"'>]+\.m3u8[^\s"'>]*)/gi;
    const match = m3u8Pattern.exec(html);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {
    console.error("GDMirrorbot extractor error:", e.message);
  }
  return null;
}

// ─── Generic extractor - try to find any m3u8 ────────────────────
async function extractGeneric(url) {
  try {
    const html = await safeFetch(url);
    if (!html) return null;
    
    const m3u8Pattern = /(https?:\/\/[^\s"'>]+\.m3u8[^\s"'>]*)/gi;
    const match = m3u8Pattern.exec(html);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {
    console.error("Generic extractor error:", e.message);
  }
  return null;
}

// Catalog handler
async function catalogHandler({ type, id, extra }) {
  const metas = [];
  try {
    let url = `${MAIN_URL}/home/`;
    if (id === "toonstream-movies") {
      url = `${MAIN_URL}/category/anime-movies/`;
    } else if (id === "toonstream-cartoons") {
      url = `${MAIN_URL}/category/animation-&-cartoon-movie/`;
    } else if (id === "toonstream-anime") {
      url = `${MAIN_URL}/category/anime-series/`;
    }
    if (extra?.search) {
      url = `${MAIN_URL}/page/1/?s=${encodeURIComponent(extra.search)}`;
    }

    const html = await safeFetch(url);
    if (!html) {
      console.error("No HTML fetched for catalog:", url);
      return { metas };
    }

    const $ = cheerio.load(html);
    const items = $("#movies-a ul > li, .movies-list li, article.post, .post-item");
    
    items.each((i, el) => {
      try {
        const $el = $(el);
        const title = $el.find("h2.entry-title, h2, .title, .post-title").first().text()?.trim()?.replace("Watch Online", "")?.trim();
        const href = $el.find("a.lnk-blk, a[href], a").first().attr("href");
        let posterRaw = $el.find("img").first().attr("src") || $el.find("img").first().attr("data-src");
        let poster = null;
        if (posterRaw) {
          if (posterRaw.startsWith("http")) poster = posterRaw;
          else if (posterRaw.startsWith("//")) poster = `https:${posterRaw}`;
          else if (posterRaw.startsWith("/")) poster = `${MAIN_URL}${posterRaw}`;
        }

        if (title && href) {
          const fullHref = href.startsWith("http") ? href : `${MAIN_URL}${href}`;
          metas.push({
            id: fullHref,
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

    console.log(`Catalog ${id}: Found ${metas.length} items`);
  } catch (error) {
    console.error("Catalog handler error:", error.message);
  }
  return { metas };
}

// Meta handler
async function metaHandler({ type, id }) {
  try {
    const html = await safeFetch(id);
    if (!html) {
      console.error("No HTML fetched for meta:", id);
      return { meta: {} };
    }

    const $ = cheerio.load(html);
    
    const title = $("header.entry-header > h1, h1.entry-title, h1").first().text()?.trim().replace("Watch Online", "") || "Unknown";
    let posterRaw = $("div.bghd > img, .poster img, .thumb img").attr("src");
    let poster = null;
    if (posterRaw) {
      if (posterRaw.startsWith("http")) poster = posterRaw;
      else if (posterRaw.startsWith("//")) poster = `https:${posterRaw}`;
      else if (posterRaw.startsWith("/")) poster = `${MAIN_URL}${posterRaw}`;
    }
    
    const description = $("div.description > p, .description p, .excerpt p").first().text()?.trim();
    
    console.log(`Meta ${id}: title="${title}", hasDescription=${!!description}`);

    if (type === "series") {
      const videos = [];
      
      const seasonButtons = $("a.season-btn, .season-btn, button[data-season]");
      console.log(`Found ${seasonButtons.length} season buttons`);
      
      if (seasonButtons.length > 0) {
        for (let i = 0; i < seasonButtons.length; i++) {
          const seasonNum = $(seasonButtons[i]).attr("data-season") || (i + 1).toString();
          const postId = $(seasonButtons[i]).attr("data-post") || "";
          
          try {
            const seasonHtml = await safeFetch(
              `${MAIN_URL}/wp-admin/admin-ajax.php`,
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
            const episodes = $season("article.post.episodes, article.post, .episode-item");
            console.log(`Season ${seasonNum}: Found ${episodes.length} episodes`);
            
            episodes.each((j, ep) => {
              try {
                const epHref = $season(ep).find("a.lnk-blk, a[href], a").first().attr("href");
                const epName = $season(ep).find("h5.entry-title1, h2.entry-title, h3.entry-title, .episode-title").first().text()?.trim();
                
                if (epHref && epName) {
                  const fullEpHref = epHref.startsWith("http") ? epHref : `${MAIN_URL}${epHref}`;
                  videos.push({
                    id: fullEpHref,
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
      } else {
        const episodes = $("article.post, .episode-item, #episode_by_temp article.post");
        console.log(`No seasons found, looking for direct episodes: ${episodes.length}`);
        
        episodes.each((j, ep) => {
          try {
            const epHref = $(ep).find("a.lnk-blk, a[href], a").first().attr("href");
            const epName = $(ep).find("h5.entry-title1, h2.entry-title, h3.entry-title, .episode-title").first().text()?.trim();
            
            if (epHref && epName) {
              const fullEpHref = epHref.startsWith("http") ? epHref : `${MAIN_URL}${epHref}`;
              videos.push({
                id: fullEpHref,
                title: epName,
                season: 1,
                episode: videos.filter((v) => v.season === 1).length + 1,
              });
            }
          } catch (e) {
            console.error("Error parsing direct episode:", e.message);
          }
        });
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
}

// Stream handler - use proper extractors
async function streamHandler({ type, id }) {
  const streams = [];
  try {
    const html = await safeFetch(id);
    if (!html) {
      console.error("No HTML fetched for stream:", id);
      return { streams };
    }

    const $ = cheerio.load(html);
    const servers = [];
    
    $("#aa-options > div > iframe, .video-server iframe, .server-list iframe, iframe[src]").each((i, iframe) => {
      try {
        let rawSrc = $(iframe).attr("data-src") || $(iframe).attr("src");
        if (rawSrc) {
          const serverlink = rawSrc.startsWith("http") ? rawSrc : `${MAIN_URL}${rawSrc}`;
          servers.push(serverlink);
        }
      } catch (e) {
        console.error("Error parsing iframe:", e.message);
      }
    });

    console.log(`Stream ${id}: Found ${servers.length} servers`);

    for (const server of servers) {
      try {
        let videoUrl = null;
        let serverName = "Server";
        
        // Use appropriate extractor based on server URL
        if (server.includes("as-cdn21.top") || server.includes("as-cdn23.top")) {
          serverName = "Zephyrflick 1080p";
          videoUrl = await extractZephyrflick(server);
        } else if (server.includes("emturbovid.com") || server.includes("turboviplay.com")) {
          serverName = "EmTurboVid 1080p";
          videoUrl = await extractEmTurboVid(server);
        } else if (server.includes("rubystm.com") || server.includes("streamruby.com")) {
          serverName = "Streamruby";
          videoUrl = await extractStreamruby(server);
        } else if (server.includes("vidmoly.net")) {
          serverName = "VidMoly";
          videoUrl = await extractVidMolyNet(server);
        } else if (server.includes("gdmirrorbot.nl") || server.includes("techinmind.space")) {
          serverName = "GDMirrorbot";
          videoUrl = await extractGDMirrorbot(server);
        } else {
          // Generic extractor for unknown servers
          serverName = "Server";
          videoUrl = await extractGeneric(server);
        }

        if (videoUrl) {
          streams.push({
            url: videoUrl,
            title: serverName,
            quality: "1080p",
          });
          console.log(`✓ Extracted video: ${serverName} - ${videoUrl}`);
        } else {
          console.log(`✗ Failed to extract video from: ${server}`);
        }
      } catch (err) {
        console.error(`Error processing server ${server}:`, err.message);
      }
    }
  } catch (error) {
    console.error("Stream handler error:", error.message);
  }
  return { streams };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(catalogHandler);
builder.defineMetaHandler(metaHandler);
builder.defineStreamHandler(streamHandler);

const addon = builder.getInterface();

const app = express();
app.use(express.json());

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.get("/configure", (req, res) => {
  res.json({
    id: ADDON_ID,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    configuration: [],
  });
});

app.get("/catalog/:type/:id.json", async (req, res) => {
  try {
    const result = await catalogHandler({
      type: req.params.type,
      id: req.params.id,
      extra: req.query,
    });
    res.json(result);
  } catch (err) {
    console.error("Catalog route error:", err.message);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/meta/:type/:id.json", async (req, res) => {
  try {
    const result = await metaHandler({
      type: req.params.type,
      id: req.params.id,
    });
    res.json(result);
  } catch (err) {
    console.error("Meta route error:", err.message);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/stream/:type/:id.json", async (req, res) => {
  try {
    const result = await streamHandler({
      type: req.params.type,
      id: req.params.id,
    });
    res.json(result);
  } catch (err) {
    console.error("Stream route error:", err.message);
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    status: "running",
    mainUrl: MAIN_URL,
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Toonstream Stremio addon listening on port ${PORT}`);
  console.log(`Manifest available at http://localhost:${PORT}/manifest.json`);
  console.log(`Using main URL: ${MAIN_URL}`);
});

module.exports = addon;
