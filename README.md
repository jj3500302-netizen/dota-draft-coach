# Draft Coach for Dota 2

A small desktop app that reads the draft from your screen and suggests heroes, then shows a tiny stats strip and objective pop-ups during the match.

**Just want to try it?** Download `DraftCoach.exe` from the [Releases](../../releases) page and double-click it. No install needed.

## What it does

- **Draft:** reads both teams' picks from the top of the screen, reads your position from the ranked role labels, and suggests heroes to pick or avoid with the reason (counters an enemy, fits a teammate, team is missing something). Click a hero to copy its name.
- **In game:** a small see-through strip with GPM, XPM, last hits, denies and KDA, plus pop-ups before runes, lotus, Shrine of Wisdom, Tormentor and day/night changes. The ☰ button opens counter-item suggestions and the Roshan / Tormentor timers.
- Thai and English.

## Using it

1. Open the app before you queue. On first run it adds one config file to Dota 2; restart Dota once after that.
2. Set Dota to **Borderless Window** (Settings > Video), otherwise the app cannot sit on top of the game.
3. Windows may warn that the app is unsigned: click **More info** > **Run anyway**.

## Limits

- Tuned on a 1920x1080 screen. Other resolutions or aspect ratios may read picks wrongly.
- Bans are not read. Role labels only exist in ranked role queue; otherwise choose your position yourself.
- Counter items are hand-written rules, not statistics. Objective times are for patch 7.41f (`assets/timings.json`).
- It only reads the screen and Dota's official Game State Integration. It does not touch the game's memory or click anything in the game.

## Running from source

```
npm install
npm start
```

`node collect.js` pulls more ranked matches from OpenDota into `data/matches.jsonl`. `npm run server` runs without the desktop window. To build the single exe: `npx electron-builder --win portable --x64`.
