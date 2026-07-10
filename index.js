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

function extractMeta($, selector) {
  const el = $(selector);
  return el.text()?.trim() || "";
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
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
    
    // Try multiple selectors to find content
    const items = $("#movies-a ul > li, .movies-list li, article.post, .post-item");
    
    items.each((i, el) => {
      try {
        const $el = $(el);
        
        // Try to find title
        const title = $el.find("h2.entry-title, h2, .title, .post-title").first().text()?.trim()?.replace("Watch Online", "")?.trim();
        
        // Try to find link
        const href = $el.find("a.lnk-blk, a[href], a").first().attr("href");
        
        // Try to find poster
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
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const html = await safeFetch(id);
    if (!html) {
      console.error("No HTML fetched for meta:", id);
      return { meta: {} };
    }

    const $ = cheerio.load(html);
    
    const title = extractMeta($, "header.entry-header > h1, h1.entry-title, h1").replace("Watch Online", "");
    let posterRaw = $("div.bghd > img, .poster img, .thumb img").attr("src");
    let poster = null;
    if (posterRaw) {
      if (posterRaw.startsWith("http")) poster = posterRaw;
      else if (posterRaw.startsWith("//")) poster = `https:${posterRaw}`;
      else if (posterRaw.startsWith("/")) poster = `${MAIN_URL}${posterRaw}`;
    }
    
    const description = extractMeta($, "div.description > p, .description p, .excerpt p");
    
    console.log(`Meta ${id}: title="${title}", hasDescription=${!!description}`);

    if (type === "series") {
      const videos = [];
      
      // Try to find seasons
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
        // Fallback: try to find episodes directly on the page
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
          name: title || "Unknown",
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
          name: title || "Unknown",
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
    const html = await safeFetch(id);
    if (!html) {
      console.error("No HTML fetched for stream:", id);
      return { streams };
    }

    const $ = cheerio.load(html);
    const servers = [];
    
    // Try multiple selectors for iframes
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
        const serverHtml = await safeFetch(server);
        if (!serverHtml) continue;
        
        const $server = cheerio.load(serverHtml);
        
        // Try to find actual video iframe
        const videoIframe = $server(".Video iframe, div.Video iframe, iframe[src], #player iframe");
        
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
            console.log(`Found stream: ${serverName} - ${truelink}`);
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
    const result = await addon.handlers.catalog(
      { type: req.params.type, id: req.params.id, extra: req.query },
      {}
    );
    res.json(result);
  } catch (err) {
    console.error("Catalog route error:", err.message);
    res.status(500).json({ error: "Internal server error", message: err.message });
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
    res.status(500).json({ error: "Internal server error", message: err.message });
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Toonstream Stremio addon listening on port ${PORT}`);
  console.log(`Manifest available at http://localhost:${PORT}/manifest.json`);
  console.log(`Using main URL: ${MAIN_URL}`);
});

module.exports = addon;
