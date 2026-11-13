# Floppa Charts

A private dashboard that tracks Roblox games over time so rising games and niches are easy to spot, with an MCP endpoint so AI assistants can read (and correct) the same data.

## Run it locally

```bash
npm install
npm run collect        # one 10-minute collection pass (fills data/radar.db)
npm run dev            # dashboard at http://localhost:3000
```

`npm run collect:loop` keeps collecting until you stop it. Growth figures need history: 1-hour growth appears after about an hour of collecting, 24-hour growth after a day.

## How data gets in

| Source | What it does |
|---|---|
| Charts | Crawls all ~26 Roblox chart lists for the default view plus two rotating device/country views per pass |
| Polling | Re-checks tracked games on a tier: charted, watched or surging games every ~15 min, 100+ players hourly, 10+ every 6 hours, the rest daily |
| New-game scan | Walks every newly created game ID once it is 1 day and 7 days old, keeping those with 10+ players or real visits |
| Search | `search_roblox` (MCP) adds every result it finds |
| Rolimons backfill | On demand, per game: pulls older history from the game's public Rolimons page |

## Pages

- **Home**: New and gaining, Fastest growing, Rising niches, plus preset shortcuts
- **Explore** and **Watchlist**: grid or list view (remembered), one-click watch and Play on every game, filters (players, age, genre, like ratio), sorting and paging; add a game by link or ID
- **Game**: stats, history chart, Play button, watch, older-history backfill, playtest notes, tags, game passes
- **Niches**: sub-genres, AI/user tags and title words, ranked by how many separate games in each group are hot
- **Alerts**: watchlist games that jump 50%+ in 24h
- **Activity**: every edit by you or an AI, with undo

## MCP

Endpoint: `POST /api/mcp` (streamable HTTP, JSON responses). Send `Authorization: Bearer <MCP_TOKEN>`, or append `?key=<MCP_TOKEN>` for clients that cannot set headers. Locally, with no `MCP_TOKEN` set, it is open.

Read tools: `list_games`, `get_game`, `get_game_history`, `list_niches`, `search_roblox`, `query_database` (read-only SQL), `get_status`, `list_presets_and_alerts`, `list_notes`, `list_edits`.

Write tools (all logged, most undoable): `add_game`, `refresh_games`, `backfill_history`, `upsert_snapshots`, `delete_snapshots`, `update_game_fields`, `set_tags`, `set_watch`, `set_note`, `save_preset`, `delete_preset`, `undo_edit`.

## Configuration

See `.env.example`. With nothing set, the app uses a local SQLite file and no password.

## AI features (need a Claude API key)

Add the key in Settings, or set `ANTHROPIC_API_KEY`. Sonnet 5.5 is used until $25 of the monthly budget is left, then Haiku 5.5; both numbers are editable in Settings.

- **Ideas**: chat that checks every answer against the tracked data, grades ideas F to SSS, and saves each conversation
- **AI tagging**: theme and mechanic tags for rising games (always Haiku), which feed the "Themes and mechanics" niches
- **Choke-points**: on a connected game, reads the analytics and lists where players or revenue are being lost; never suggests fixes; each finding can be dismissed

## My games

Connect games you own with Roblox Open Cloud API keys (permission `universe.analytics:read`). Several keys for several accounts or groups are supported. Shows engagement, retention, monetization, acquisition and performance for the last 28 days against the 28 before, plus platform and session-length breakdowns.

## Hosting

See [DEPLOY.md](DEPLOY.md) for the free 24/7 setup (Turso + GitHub Actions + Vercel).

## Checks

`npx tsx scripts/selftest.ts` runs offline checks on the analytics parser, pricing and niche keyword logic.
