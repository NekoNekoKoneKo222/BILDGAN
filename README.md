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

## Windows local hosting with Tailscale Funnel

This project runs a Node.js HTTP + WebSocket server. To avoid disrupting other games already using Funnel port 443 and 8443, host BILDGAN on local port **8792** and expose it on HTTPS port **10000**.

**One-click setup:** run `start-bildgan.cmd` in the repository directory. The batch file checks Node dependencies, runs checks and tests, builds the client, and runs the server on port 8792. Keep this terminal running while players are connected.

In a **second** PowerShell or Command Prompt window, run:

```powershell
tailscale funnel --bg --https=10000 http://127.0.0.1:8792
tailscale funnel status
```

Check the local app first at `http://127.0.0.1:8792`, then open the public HTTPS URL shown by Tailscale, typically `https://<device>.<tailnet>.ts.net:10000`.

Manual alternative from PowerShell (use `npm.cmd` instead of `npm` when PowerShell script execution is restricted):

```powershell
git clone https://github.com/NekoNekoKoneKo222/BILDGAN.git
cd BILDGAN
npm.cmd install --no-audit --no-fund
npm.cmd run check
npm.cmd test
npm.cmd run build
$env:PORT=8792
npm.cmd start
```

To stop publishing **only BILDGAN** (keep other Funnel mappings intact):

```powershell
tailscale funnel --https=10000 off
```

The local game server must remain running, and Windows must remain awake and connected to Tailscale. Funnel is **public to the internet**; do not expose private admin endpoints or personal files. Funnel has bandwidth limits. Check `tailscale funnel status` before changing your existing mappings.

Do **not** run `tailscale funnel reset` or overwrite ports 443/8443 if you need the other games to stay online.

Render deployment remains separately configured unless you explicitly remove or disable it.
