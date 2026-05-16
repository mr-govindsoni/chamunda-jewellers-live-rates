# Chamunda Jewellers

Mobile-first live dashboard for Gold and Silver rates. It fetches public MCX/COMEX-style market rows through the local Node server and refreshes the UI every 30 seconds.

## Run

```sh
node server.js
```

Open `http://localhost:4173`.

To override the built-in metals API key:

```sh
METAL_PRICE_API_KEY=your_key_here node server.js
```

## Notes

- COMEX/spot data is attempted through MetalpriceAPI and falls back to public market rows if needed.
- MCX data is parsed from public market pages and cached for 30 seconds.
- For trading, confirm values with your broker or exchange-authorized feed.
- `PORT=5000 node server.js` runs the app on a different port.

## Deploy Online

This app needs Node hosting because `/api/rates` runs on the server.

Good options:

- Render / Railway / Fly.io / VPS: run as a Node web service.
- Start command: `npm start`
- Environment variable: `METAL_PRICE_API_KEY`
- App listens to the platform `PORT` automatically.

For Render, `render.yaml` is included. Create a new web service from this repo, set `METAL_PRICE_API_KEY`, and deploy.
