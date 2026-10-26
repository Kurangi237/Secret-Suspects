# Secret Suspects

A browser-based, server-authoritative noir social deduction game for 3–8 players. The frontend is vanilla JavaScript/CSS; Netlify Functions handle game actions and Netlify Blobs stores shared room state.

## Features implemented in this project

- Create a private room with a random six-character code; join with code and nickname.
- Three-to-eight player lobby, host controls, player removal before a match, and room locking while a match is active.
- One hidden impostor; investigators receive the same secret case word; role-sensitive state responses do not reveal the impostor's word.
- Built-in case library with progressive clues.
- Server-authoritative 60-second discussion, 20-second anonymous vote, 15-second tie revote, and server-side victory resolution.
- Live text chat during discussion; chat is disabled during voting.
- Reconnection grace period, server-driven host transfer, anti-duplicate vote validation, role reveal and match leaderboard.
- Match rematch flow and responsive noir interface.
- First-visit three-step tutorial with Skip and Got It.

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```

`netlify dev` serves the Vite frontend and the `/.netlify/functions/game` function. Netlify Blobs is automatically available in a deployed Netlify function. For local development, use a current Netlify CLI login/site link if required by your Blobs setup.

## Deploy to Netlify

1. Create a new Netlify site or select the site you control.
2. Deploy this project root (Git integration or Netlify CLI).
3. Use the build settings in `netlify.toml`: build command `npm run build`, publish directory `dist`, functions directory `netlify/functions`.
4. Netlify provisions site-wide Blobs for the `secret-suspects-rooms` store from the function runtime; no application API keys are hardcoded in this repository.
5. After deployment, open the public site URL on at least three separate devices/browsers and test room creation, joining, secret-role isolation, chat, voting, ties, disconnect/reconnect, host transfer, victory conditions, and rematch.

## Important architecture note

Netlify Blobs supports strong-consistency reads and conditional writes. This function uses ETag-based conditional writes with bounded retries to avoid silent last-write-wins overwrites of a room during concurrent actions. This is still a lightweight game backend: before using it for a large public audience, stress-test simultaneous writes, monitor function errors, and consider a transactional database if concurrency grows.

## Validation

Run `npm test` for the included case-library and room-code checks. Run `npm run build` for the frontend production build. These checks do not replace an end-to-end test against a deployed Netlify site.

## Build-environment note

A `package-lock.json` could not be generated in the current environment because package-registry resolution timed out. Generate and commit one in a network-enabled environment with `npm install` before using `npm ci`-based reproducible builds. The project intentionally does not include a fabricated or incomplete lockfile.
