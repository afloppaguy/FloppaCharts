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

## Signals

| Signal | Meaning | History needed |
|---|---|---|
| Growth | Players now against 24 hours ago (or 1 hour ago, or first tracked, until a day of history exists) | 1 hour to 1 day |
| Rise score | Players gained relative to the game's size; the default sort | same as growth |
| Pace | Visits per hour right now divided by the game's lifetime average. x2 = twice its usual rate | two snapshots |
| Est. session | Players online divided by visits per minute: roughly how long one visit lasts | two snapshots |

Timestamps are always real time: on start-up the app checks a Roblox server's clock and corrects for a wrong local clock.

## Pages

- **Home**: New and gaining, Fastest growing, Rising niches, plus preset shortcuts
- **Explore** and **Watchlist**: grid or list view (remembered), one-click watch and Play on every game, filters (players, age, genre, like ratio), sorting and paging; add a game by link or ID
- **Game**: stats, history chart, Play button, watch, older-history backfill, playtest notes, tags, game passes
- **Niches**: sub-genres, AI/user tags and title words, ranked by how many separate games in each group are hot
- **Compare**: up to five games on one chart, by players or indexed growth, with a side-by-side stats table
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

## Security

- **Sign-in**: one password (`DASH_PASSWORD`). Sessions are signed, expire after 30 days, and are invalidated by changing the password or `SESSION_SECRET`. Five wrong passwords lock an address out for 15 minutes; 30 wrong passwords from anywhere pause sign-in for an hour. A hosted deployment without `DASH_PASSWORD` serves nothing.
- **AI connection**: `/api/mcp` needs `MCP_TOKEN`. Ten wrong tokens lock an address out for 15 minutes; a valid token may make 240 requests a minute.
- **Limits**: 12 chat messages a minute and 300 a day; 40 other AI actions an hour; search suggestions and game cards are throttled per address. All of this sits on top of the monthly AI budget.
- **Saved keys**: the Claude key and Roblox keys saved in the dashboard are encrypted (AES-256-GCM) with a key derived from `SECRETS_KEY`, or else from `TURSO_AUTH_TOKEN`. If that value changes, saved keys must be entered again. AI SQL queries cannot read the tables that hold keys or security state.
- **Browser**: a content security policy limits what pages may load (this site plus Roblox's image servers), the site cannot be framed, requests that change data must come from the site itself, and search engines are told not to index it.

## People

The owner signs in with `DASH_PASSWORD`. Other people get their own password under **Settings > People** (or `npx tsx scripts/add-member.ts "Name" "password"`). They can use everything except API keys, the AI budget and the People list. Their passwords are stored as salted scrypt hashes; removing a person signs them out within half a minute.

## Several people

Settings → People adds extra sign-ins. Each person has their own Claude key, budget, model choice, Roblox keys, connected games and idea chats; nobody sees or spends anyone else's. Market data, tags, the watchlist, notes, the briefing and the gap finder are shared.
