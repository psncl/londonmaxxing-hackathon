## Project Info

This project is for a 1-day hackathon. It is a minimalist webpage for mobiles that asks the user for the name of a
London Underground station and:

- displays whether the station has step-free access.
- if the station has multiple lines, displays which lines are step-free.
- if the station doesn't have step-free access, display the nearest step-free station.
- any current lift or escalator disturbances or repair work going on.

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: mcp

## Architecture

The app is offline-first: once loaded, station lookups never require a network request. Two layers:

**Build-time ETL** (`scripts/build-station-data.ts`, run via `pnpm build:data`) assembles `static/seed.sqlite`:
- Station list, coordinates, and lines served come from TfL's live `StopPoint` API (`/StopPoint/Mode/tube`).
- Step-free status per station is a hybrid: TfL's own per-station `AccessViaLift` accessibility flag
  (from the `Accessibility`/LRAD category on the individual `/StopPoint/{id}` endpoint) when present.
  TfL's API omits this category entirely for hub/interchange stations (King's Cross, Westminster,
  Stratford, Bond Street, etc.), so for those, the ETL falls back to matching the station name against
  Wikipedia's "Underground station gained step-free access" table (a citation-backed accessibility
  retrofit history), fetched and parsed from raw wikitext at build time.
  - Deliberately NOT sourced from the static `tfl-stationdata-detailed.zip`'s
    `Platforms.HasStepFreeRouteInformation` field — that field flags platform-to-platform interchange
    info, not street-to-platform accessibility (it false-positives on Covent Garden, which has no
    lift/ramp from street to platform at all).
  - Per-line breakdown is not attempted: TfL doesn't expose a per-line accessibility flag, and deriving
    one reliably from the raw lift/ramp topology data would need a full reachability graph + fuzzy
    platform matching. Every line at a station shares the station's single step-free status.
- Nearest step-free station is precomputed per non-step-free station: BFS over the tube network graph
  (built from `/Line/{id}/Route/Sequence` for both directions on all 11 lines), falling back to
  straight-line (haversine) distance only if BFS finds nothing (e.g. an isolated branch).
- Live disruption tables (`lift_disruptions`, `line_disruptions`) are left empty by the ETL — they're
  populated at runtime, not baked into the seed.

**Client runtime**:
- `src/lib/db.ts` loads `seed.sqlite` into `sql.js` (WASM SQLite) on first visit, persists the
  serialized bytes into IndexedDB, and reads from IndexedDB on every subsequent load — no network
  required. When online, it refreshes the IndexedDB copy in the background for next time.
- `src/lib/data/queries.ts` — typed query functions (station search, station detail incl. lines +
  nearest step-free, lift/line disruptions, replacing cached disruption rows).
- `src/routes/api/disruptions/+server.ts` — thin server-side proxy to TfL's live
  `/Disruptions/Lifts/v2` and `/Line/{ids}/Disruption` endpoints. Exists because TfL's CORS support is
  inconsistent across endpoints and the TfL app key (`TFL_APP_KEY` env var) shouldn't be shipped to the
  client. The client only calls this when online; on failure it keeps showing the last cached rows with
  their `fetched_at` timestamp.
- A service worker (`@vite-pwa/sveltekit`, configured in `vite.config.ts`) precaches the app shell,
  `seed.sqlite`, and `sql-wasm.wasm`, making the app installable and usable with zero connectivity from
  first load. The root route is prerendered (`src/routes/+page.ts`) specifically so there's a static
  HTML shell for the service worker to serve offline — without it there's nothing for the
  `NavigationRoute` fallback to return. `clientsClaim`/`skipWaiting` are enabled so the very first
  reload after initial load is already offline-capable, not just subsequent ones.

## Data Storage

Single SQLite file, `static/seed.sqlite`, shared schema between the build-time seed and the client-side
runtime copy (loaded via `sql.js` in the browser, persisted as raw bytes in IndexedDB):

```sql
CREATE TABLE stations (
    id TEXT PRIMARY KEY,           -- TfL naptanId, e.g. "940GZZLUGPK"
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    has_step_free INTEGER NOT NULL -- 0/1, station-level only (see Architecture)
);

CREATE TABLE lines (
    id TEXT PRIMARY KEY,           -- TfL line id, e.g. "victoria"
    name TEXT NOT NULL             -- display name, e.g. "Victoria"
);

CREATE TABLE station_lines (
    station_id TEXT NOT NULL REFERENCES stations(id),
    line_id TEXT NOT NULL REFERENCES lines(id),
    PRIMARY KEY (station_id, line_id)
);

CREATE TABLE nearest_step_free (
    station_id TEXT PRIMARY KEY REFERENCES stations(id),
    nearest_station_id TEXT NOT NULL REFERENCES stations(id),
    hops INTEGER NOT NULL,         -- BFS hop count along the line network; -1 = haversine fallback used
    distance_m REAL NOT NULL
);

CREATE TABLE lift_disruptions (
    station_id TEXT NOT NULL,
    lift_id TEXT NOT NULL,
    message TEXT NOT NULL,
    fetched_at TEXT NOT NULL       -- ISO timestamp, set when the client synced this row live
);

CREATE TABLE line_disruptions (
    line_id TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);

CREATE TABLE meta (
    key TEXT PRIMARY KEY,          -- e.g. "seed_version" (ISO timestamp of last ETL run)
    value TEXT NOT NULL
);
```

`lift_disruptions` and `line_disruptions` start empty in the shipped seed file and are populated/replaced
client-side (via `replaceDisruptions` in `queries.ts`) whenever the app successfully calls the
`/api/disruptions` proxy while online.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
