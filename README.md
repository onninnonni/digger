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
