# Hosting Floppa Charts for free, 24/7

Three free services, each doing one job:

| Service | Job | Why |
|---|---|---|
| **Turso** | The database | Hosted SQLite; the app already speaks it |
| **GitHub** | Runs the collector every 15 minutes | Scheduled Actions are free on public repositories |
| **Vercel** | Serves the dashboard, the chat and the MCP endpoint | Free Hobby plan for personal projects |

You need an account on each. The steps below take about 20 minutes.

## 1. Database (Turso)

1. Sign up at turso.tech and create a database (any name, nearest region).
2. Copy its **URL** (starts with `libsql://`) and create a **token** with read and write access.
3. Optional, to keep the data you have collected locally: install the Turso CLI and run
   `turso db shell <name> < dump.sql` after `sqlite3 data/radar.db .dump > dump.sql`.
   Otherwise the hosted database simply starts empty and fills within one collector run.

## 2. Code (GitHub)

1. Create a new **public** repository on github.com (GitHub Desktop: File, Add local repository, then Publish, with "Keep this code private" unticked).
   Nothing secret is in the code: keys live in the services' settings, and `data/` and `.env*` are ignored.
2. In the repository: Settings, Secrets and variables, Actions, New repository secret. Add:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
3. Open the Actions tab, enable workflows if asked, pick **collect**, and press **Run workflow** once to confirm it goes green.
   After that it runs by itself every 15 minutes (GitHub may start runs a few minutes late).

GitHub pauses scheduled workflows after 60 days without any commit. Pushing any change, or pressing Run workflow, keeps it alive.

## 3. Dashboard (Vercel)

1. Sign up at vercel.com with your GitHub account and import the repository. The defaults are correct.
2. Before deploying, add these Environment Variables:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | same as in step 2 |
| `TURSO_AUTH_TOKEN` | same as in step 2 |
| `DASH_PASSWORD` | the password you will type to open the dashboard |
| `MCP_TOKEN` | a long random string; AI clients must send it |
| `ANTHROPIC_API_KEY` | your Claude API key (optional; turns on chat, tagging and choke-points) |

3. Deploy. Open the address Vercel gives you and sign in with `DASH_PASSWORD`.

## 4. Install it as an app

Open the dashboard in Chrome or Edge and click the install icon at the right of the address bar. It then opens in its own window with a taskbar icon.

## 5. Connect Claude (MCP)

- Address: `https://<your-site>/api/mcp`
- Auth: header `Authorization: Bearer <MCP_TOKEN>`. For clients that cannot set headers, use `https://<your-site>/api/mcp?key=<MCP_TOKEN>`.

Claude Code, for example:

```bash
claude mcp add --transport http floppa https://<your-site>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

## Limits to know

- **Turso free plan**: about 10 million row writes a month. The collector's tiered polling is sized for that; if you ever hit it, lower the run length in `.github/workflows/collect.yml` (`npm run collect -- 10`).
- **Vercel Hobby**: functions stop after 300 seconds, so a single chat reply cannot run longer than that.
- **Roblox**: the public game endpoint allows roughly 20 requests a minute per address. This was measured from a home connection, not from GitHub's servers; if runs show many "rate-limited" lines, that is the cause.
