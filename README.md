# Digger: Dig to China

A fast-paced TypeScript + WebGL2 arcade game. Dig straight down through the Earth, from topsoil to the core and out the other side, while dodging lava, cave-ins, falling boulders, gas pockets and subway trains.

**Play:** https://pikos.org/onni/digger/

## Features

- Raw WebGL2 batched renderer with per-tile dynamic lighting (headlamp, lava glow, train headlights)
- Procedurally generated world: 7 geological bands, gem veins, lava pockets, caves, subway tunnels
- Hazards: flowing and falling lava, collapsing tunnels, boulders, exploding gas, timed trains
- Gold, emeralds, rubies, diamonds and core crystals give points and level up your drill (faster digging, +1 heart)
- Procedural chiptune music and sound effects via the Web Audio API, no audio files
- Works on phones: touch joystick anywhere on screen plus on-screen buttons
- Zero runtime dependencies; textures are drawn with Canvas2D at startup

## Controls

- Desktop: arrows or WASD to move and dig, Down to dig down, Up or Space to jump or dig up, P to pause, M to mute
- Phone: hold anywhere to dig down, drag to move or dig sideways, swipe up to jump, or use the buttons

## Google sign-in and leaderboard

Signed-in players get their best score on a shared top-10 list. The game itself is static; the
leaderboard lives in a tiny zero-dependency Node service in `server/`:

- `GET  api/config`  → `{ configured, clientId, players }` (the game hides the panel when this 404s)
- `GET  api/scores`  → top scores
- `POST api/scores`  → `{ idToken, score, depthKm, level, won }`; the Google ID token is verified
  server-side against Google's `tokeninfo` endpoint and the configured OAuth client ID, and only
  one best score per Google account is kept in `~/digger-data/scores.json`.

The client uses Google Identity Services (the standard "Sign in with Google" button), so the OAuth
client only needs `https://pikos.org` as an authorized JavaScript origin. No client secret is needed.

Server setup (as user `onni`, no root):

```bash
rsync -a -e 'ssh -p 2323' server/server.js server/digger.service onni@pikos.org:~/digger-backend/
ssh -p 2323 onni@pikos.org 'cp ~/digger-backend/digger.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now digger && loginctl enable-linger onni'
```

`~/digger-backend/config.json` holds the port and accepted client IDs (see `server/config.example.json`).
Caddy must route the API to the service. The permanent way is the block in `server/Caddyfile.snippet`
in `/etc/caddy/Caddyfile` (needs root). Until that is done, `server/caddy-route.sh` injects the same
route into the running Caddy through its local admin API, and the `digger-caddy-route.timer` user
timer re-applies it within two minutes of any Caddy reload.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build into dist/
```

The site is built for the `/onni/digger/` base path (see `vite.config.ts`). Deploy by uploading `dist/` to the web server:

```bash
rsync -av --delete --chmod=D755,F644 -e 'ssh -p 2323' dist/ onni@pikos.org:/srv/www/onni/digger/
```
