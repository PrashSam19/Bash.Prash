# prashanth-site

Personal site of Prashanth Sampathkumar. Built with [Astro](https://astro.build),
hosted on Netlify.

## Run locally

```bash
npm install
npm run dev
```

Open the URL it prints, usually http://localhost:4321.

## Where things live

| What | Where |
|---|---|
| Name, tagline, nav order, links | `src/data/site.ts` |
| About and Now pages | `src/pages/about.astro`, `src/pages/now.astro` |
| Games, Tools, Playground entries | `src/content/<section>/*.md` |
| Background photos | `src/assets/bg-light.jpg`, `src/assets/bg-dark.jpg` |
| Theme toggle icon source | `src/assets/toggle-koi.png` (ink mask; the source photo lives in `PrashPics/`, which is not committed) |
| About page headshot | `src/assets/headshot.jpg` |
| Playable games | `src/components/games/` (UI) and `src/games/` (logic) |
| Colors, type, layout | `src/styles/global.css` |

## Adding an entry

Create a markdown file in `src/content/games/`, `src/content/tools/`, or
`src/content/playground/`. The file name becomes the URL. Frontmatter:

```yaml
---
title: Snake
summary: One sentence shown in the list.
status: idea        # idea | building | live
order: 1            # lower sorts first
repo: https://github.com/PrashSam19/sudoku  # optional
demo: https://snake.example.com             # optional
tags: [canvas, javascript]                  # optional
---
```

Anything below the frontmatter is the page body.

## Background photos

One photo per theme: `src/assets/bg-light.jpg` and `src/assets/bg-dark.jpg`.
Replace the files to change them. Both are resized and converted to WebP at
build time and both load up front, so the toggle crossfades instantly.

## Playable games

Add `play: sudoku` to a game's frontmatter to render the Sudoku board above
its write-up. Players can enter a name; wins are counted per browser in
localStorage and shown in a leaderboard under the board. New games register in `src/components/games/index.ts`. Engine
tests run with `npm test`.

## Deploy

Push to GitHub, then in Netlify choose "Import an existing project" and pick
the repo. `netlify.toml` already sets the build command and output folder.
