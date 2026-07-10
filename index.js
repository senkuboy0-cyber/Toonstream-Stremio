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
async function extractStreamruby(url) {
  try {
    const newUrl = url.includes("/e/") ? url.replace("/e/", "/") : url;
    const html = await safeFetch(newUrl);
    if (!html) return null;
    
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
async function extractVidMolyNet(url) {
  try {
    const html = await safeFetch(url);
    if (!html) return null;
    
    const jwPattern = /["']file["']\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi;
    const jwMatch = jwPattern.exec(html);
    if (jwMatch && jwMatch[1]) {
      return jwMatch[1];
    }
    
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

// ─── Generic extractor ───────────────────────────────────────────
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

// ─── Recursive embed page fetcher ────────────────────────────────
// Fetch embed page and look for actual video iframe or m3u8
async function resolveEmbedPage(url) {
  let currentUrl = url;
  let depth = 0;
  const maxDepth = 3; // Prevent infinite loops
  
  while (depth < maxDepth) {
    depth++;
    console.log(`  [depth=${depth}] Fetching: ${currentUrl}`);
    
    const html = await safeFetch(currentUrl);
    if (!html) break;
    
    const $ = cheerio.load(html);
    
    // Try to find m3u8 directly in page source
    const m3u8Pattern = /(https?:\/\/[^\s"'>]+\.m3u8[^\s"'>]*)/gi;
    const m3u8Match = m3u8Pattern.exec(html);
    if (m3u8Match && m3u8Match[1]) {
      console.log(`  Found m3u8 in page source: ${m3u8Match[1]}`);
      return m3u8Match[1];
    }
    
    // Try to find video iframe
    const videoIframe = $(".Video iframe, div.Video iframe, iframe[src], #player iframe");
    if (videoIframe.length > 0) {
      const iframeSrc = videoIframe.first().attr("src");
      if (iframeSrc) {
        // If iframe points to another embed page, continue recursion
        if (iframeSrc.includes("/embed/") || iframeSrc.includes("embed")) {
          currentUrl = iframeSrc.startsWith("http") ? iframeSrc : `${MAIN_URL}${iframeSrc}`;
          continue;
        }
        
        // If it's a direct video URL (m3u8, mp4, etc.)
        if (iframeSrc.includes(".m3u8") || iframeSrc.includes(".mp4")) {
          console.log(`  Found video iframe: ${iframeSrc}`);
          return iframeSrc;
        }
        
        // If it's an external player (youtube, vimeo, etc.)
        if (iframeSrc.includes("youtube.com") || iframeSrc.includes("youtu.be")) {
          console.log(`  Found YouTube embed: ${iframeSrc}`);
          return iframeSrc;
        }
        
        // Otherwise fetch the iframe page
        currentUrl = iframeSrc.startsWith("http") ? iframeSrc : `${MAIN_URL}${iframeSrc}`;
        continue;
      }
    }
    
    // Try to find data-hash attribute (EmTurboVid style)
    const dataHash = $("#video_player[data-hash]").attr("data-hash");
    if (dataHash && dataHash.includes(".m3u8")) {
      console.log(`  Found data-hash: ${dataHash}`);
      return dataHash;
    }
    
    // Try to find "file" key in JavaScript (Streamruby style)
    const fileMatch = html.match(/["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/i);
    if (fileMatch && fileMatch[1]) {
      console.log(`  Found file key: ${fileMatch[1]}`);
      return fileMatch[1];
    }
    
    // No more nested embeds found
    break;
  }
  
  console.log(`  Could not resolve video URL from: ${url}`);
  return null;
}

// ─── Identify server type and extract video URL ──────────────────
async function extractVideoFromServer(serverUrl) {
  // First, try to resolve the embed page recursively
  const videoUrl = await resolveEmbedPage(serverUrl);
  if (!videoUrl) return null;
  
  // Determine server name and quality
  let serverName = "Server";
  let quality = "unknown";
  
  if (videoUrl.includes("as-cdn21.top") || videoUrl.includes("as-cdn23.top")) {
    serverName = "Zephyrflick 1080p";
    quality = "1080p";
  } else if (videoUrl.includes("emturbovid.com") || videoUrl.includes("turboviplay.com")) {
    serverName = "EmTurboVid 1080p";
    quality = "1080p";
  } else if (videoUrl.includes("rubystm.com") || videoUrl.includes("streamruby.com")) {
    serverName = "Streamruby";
    quality = "unknown";
  } else if (videoUrl.includes("vidmoly.net")) {
    serverName = "VidMoly";
    quality = "unknown";
  } else if (videoUrl.includes("gdmirrorbot.nl") || videoUrl.includes("techinmind.space")) {
    serverName = "GDMirrorbot";
    quality = "unknown";
  } else if (videoUrl.includes("youtube.com") || videoUrl.includes("youtu.be")) {
    serverName = "YouTube";
    quality = "unknown";
  } else if (videoUrl.includes(".m3u8")) {
    serverName = "Direct Stream";
    quality = "1080p";
  }
  
  return {
    url: videoUrl,
    title: serverName,
    quality: quality,
  };
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

// Stream handler - recursively resolve embed pages
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
    
    // Find all iframe servers
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
        const result = await extractVideoFromServer(server);
        
        if (result) {
          streams.push({
            url: result.url,
            title: result.title,
            quality: result.quality,
          });
          console.log(`✓ Extracted video: ${result.title} - ${result.url}`);
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
