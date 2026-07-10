# Toonstream Stremio Add-on

Stremio addon for streaming anime, cartoons and movies from **Toonstream** with Hindi dub support.

## Supported Sources

- Toonstream (toon-stream.site)

## Supported Types

- Anime Movies
- Cartoons
- Anime Series

## Local Development

1. Clone this repo:
   ```
   git clone https://github.com/senkuboy0-cyber/Toonstream-Stremio.git
   cd Toonstream-Stremio
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run the addon locally:
   ```
   npm start
   ```

4. The addon will be available at `http://localhost:8080/manifest.json`

## Deploy

### Deploy on Glitch

1. Create a new project on [Glitch](https://glitch.com/)
2. Import from GitHub: `https://github.com/senkuboy0-cyber/Toonstream-Stremio`
3. Glitch will automatically install dependencies and run `npm start`

### Deploy on Heroku

```
heroku create your-app-name
git push heroku main
heroku open
```

### Deploy with Docker

```bash
docker build -t toonstream-stremio .
docker run -p 8080:8080 toonstream-stremio
```

### Deploy on Render / Railway / Fly.io

Connect your GitHub repo and set the start command to:
```
npm start
```

## Install in Stremio

1. Open Stremio app
2. Go to Settings > Extensions
3. Click the "+" button
4. Paste your deployed addon URL followed by `/manifest.json`

Example:
```
https://your-app.onrender.com/manifest.json
```

## Addon URL

Once deployed, your addon manifest will be available at:
```
https://your-domain.com/manifest.json
```

## Credits

- Original extension by [Phisher98](https://github.com/phisher98)
- Cloudstream3 by [recloudstream](https://github.com/recloudstream)

## Disclaimer

This extension is for **educational purposes only**. We do not host or distribute any content. All content is fetched from third-party sources. Use at your own risk.

## License

MIT License - see LICENSE file for details.
