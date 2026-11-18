# BILDGAN — BUILD YOUR BATTLE

A 3D first-person physics shooter built for tight five-minute matches, custom weapons and reactive arenas.

## Game modes
- **Solo Scrimmage:** fight a bot, objective scoring, practice with no teammates required
- **Scrap Clash:** room-code multiplayer free-for-all; the host starts when ready
- **Core Breaker:** up to four players fight a three-phase mechanical boss

## The hook
Create a loadout with **five individually selectable gun modules**. Compete for three energy relays, build limited defensive devices, use explosive barrels and the physics gun to throw loose objects. Weapon parts trade fire rate, accuracy, damage, recoil, and energy; there is no permanent gameplay advantage from progression.

## Controls
WASD move, mouse look, left click fire, right click physics-grab / throw, Space jump, Shift sprint, B switch combat/build mode, 1–6 select building part, R rotate, E interact, Escape release pointer. Touch: virtual stick, touch-to-look, fire and mode buttons.

## Run
```bash
npm install
npm run check
npm test
npm run build
npm start
```
Open http://localhost:3000. To develop the Vite client independently, run `npm run dev` (requires a running server/proxy for WebSocket features); production mode serves compiled assets from `dist/`.

## Deployment
GitHub -> Render **Web Service**, runtime Node, Singapore region. Build `npm install --no-audit --no-fund && npm run check && npm run test && npm run build`; start `npm start`. Health check `/healthz`. Or deploy the `render.yaml` Blueprint.

## Current development status
**Playable public-alpha code, not a finished commercial launch.** Room-code PvP, solo bot battles, cooperative boss and procedural visuals are in scope. Persistence currently uses browser localStorage for blueprints/settings; player profiles, cloud saves, moderation, ranking integrity, accessibility QA, mobile performance QA and cross-device playtesting are required before calling this a full release. Server performs authoritative hits, damage, rooms and physics objects, but full collision-based movement authority is a later milestone.

## Design principles
1. Five minutes max per round including results; no endless matchmaking forced on players.
2. Fight for relays so camping is not optimal; kills are worthwhile but not sufficient.
3. Every loadout has strengths and weaknesses; cosmetic-only post-match progression.
4. Make unexpected physical interactions the best moments, not random instant deaths.
5. Offer low-effects controls to keep lower-end devices playable.

Repository name BILDGAN is kept by design.
