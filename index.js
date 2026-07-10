const { addonBuilder, serializeUrl } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const MAIN_URL = "https://toon-stream.site";
const ADDON_ID = "com.toonstream.stremio";

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

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const metas = [];
  try {
    let url = `${MAIN_URL}/`;
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
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const $ = cheerio.load(response.data);
    $("#movies-a ul > li").each((i, el) => {
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
    });
  } catch (error) {
    console.error("Catalog handler error:", error.message);
  }
  return { metas };
});

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const response = await axios.get(id, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const $ = cheerio.load(response.data);
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
          const seasonResponse = await axios.post(
            `${MAIN_URL}/wp-admin/admin-ajax.php`,
            { action: "action_select_season", season: seasonNum, post: postId },
            {
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
              timeout: 10000,
            }
          );
          const $season = cheerio.load(seasonResponse.data);
          $season("article.post.episodes, article.post").each((j, ep) => {
            const epHref = $season(ep).find("a.lnk-blk, a").attr("href");
            const epName = $season(ep).find("h5.entry-title1, h2.entry-title, h3.entry-title")?.text()?.trim();
            if (epHref && epName) {
              videos.push({
                id: epHref,
                title: epName,
                season: parseInt(seasonNum),
                episode: videos.filter((v) => v.season === parseInt(seasonNum)).length + 1,
              });
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
          videos: videos,
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
    const response = await axios.get(id, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const $ = cheerio.load(response.data);
    const servers = [];
    $("#aa-options > div > iframe").each((i, iframe) => {
      let rawSrc = $(iframe).attr("data-src");
      if (!rawSrc) rawSrc = $(iframe).attr("src");
      if (rawSrc) {
        const serverlink = rawSrc.startsWith("http") ? rawSrc : `${MAIN_URL}${rawSrc}`;
        servers.push(serverlink);
      }
    });
    for (const server of servers) {
      try {
        const serverResponse = await axios.get(server, {
          timeout: 5000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const $server = cheerio.load(serverResponse.data);
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
  const result = await addon.handlers.catalog(
    { type: req.params.type, id: req.params.id, extra: req.query },
    {}
  );
  res.json(result);
});

app.get("/meta/:type/:id.json", async (req, res) => {
  const result = await addon.handlers.meta(
    { type: req.params.type, id: req.params.id },
    {}
  );
  res.json(result);
});

app.get("/stream/:type/:id.json", async (req, res) => {
  const result = await addon.handlers.stream(
    { type: req.params.type, id: req.params.id },
    {}
  );
  res.json(result);
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
