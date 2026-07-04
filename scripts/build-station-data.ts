// Build-time ETL: assembles static/seed.sqlite from TfL's live StopPoint API.
//
// Station-level step-free status is a hybrid of two sources:
//  1. Each station's individual StopPoint record ("Accessibility" category,
//     "AccessViaLift" property) - TfL's own vetted (LRAD-sourced) flag. This
//     is authoritative when present, but TfL's API omits this category
//     entirely for hub/interchange stations (e.g. King's Cross, Westminster,
//     Stratford, Bond Street all come back with zero Accessibility
//     properties, hub or not).
//  2. For stations where that category is missing, fall back to Wikipedia's
//     "Underground station gained step-free access" table (a heavily
//     citation-backed history of accessibility works), matched by
//     normalized station name.
// This is deliberately NOT sourced from the static
// tfl-stationdata-detailed.zip's Platforms.HasStepFreeRouteInformation
// field: that field turned out to flag platform-to-platform interchange
// info, not street-to-platform accessibility (e.g. it false-positives on
// Covent Garden, which has no lift/ramp from street to platform at all).
//
// Per-line breakdown is not attempted for now: TfL doesn't expose a
// per-line accessibility flag, and deriving one from the raw lift/ramp
// topology data reliably would need a full reachability graph + fuzzy
// platform matching. Every line at a station currently shares the
// station's single step-free status.
//
// Re-run with `pnpm build:data` whenever station/line structure changes.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const TFL_APP_KEY = process.env.TFL_APP_KEY;
const SEED_DB_PATH = "static/seed.sqlite";
const INDIVIDUAL_FETCH_CONCURRENCY = 8;

const TUBE_LINES = [
	"bakerloo",
	"central",
	"circle",
	"district",
	"hammersmith-city",
	"jubilee",
	"metropolitan",
	"northern",
	"piccadilly",
	"victoria",
	"waterloo-city"
] as const;

function withKey(url: string): string {
	if (!TFL_APP_KEY) return url;
	const sep = url.includes("?") ? "&" : "?";
	return `${url}${sep}app_key=${TFL_APP_KEY}`;
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(withKey(url));
	if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
	return (await res.json()) as T;
}

interface TflStopPoint {
	naptanId: string;
	commonName: string;
	lat: number;
	lon: number;
	stopType: string;
	lines: { id: string; name: string }[];
	additionalProperties?: { category: string; key: string; value: string }[];
}

interface TflLineSequence {
	orderedLineRoutes: { naptanIds: string[] }[];
}

async function fetchStationList(): Promise<TflStopPoint[]> {
	const data = await fetchJson<{ stopPoints: TflStopPoint[] }>(
		"https://api.tfl.gov.uk/StopPoint/Mode/tube"
	);
	return data.stopPoints.filter((sp) => sp.stopType === "NaptanMetroStation");
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results;
}

type StepFreeSource = "lrad" | "wikipedia-fallback" | "none";

// The bulk /StopPoint/Mode/tube response truncates additionalProperties per
// station, so the accessibility flag has to come from the per-station endpoint.
// Returns null when TfL's own LRAD data is absent for this station, signalling
// the caller should consult the Wikipedia fallback instead.
async function fetchLradStepFree(stationId: string): Promise<boolean | null> {
	const sp = await fetchJson<TflStopPoint>(`https://api.tfl.gov.uk/StopPoint/${stationId}`);
	const accessibilityProps = (sp.additionalProperties ?? []).filter(
		(p) => p.category === "Accessibility"
	);
	const accessViaLift = accessibilityProps.find((p) => p.key === "AccessViaLift");
	if (!accessViaLift) return null;
	return accessViaLift.value === "Yes";
}

function normalizeStationName(name: string): string {
	return name
		.replace(/ Underground Station$/i, "")
		.replace(/\s*\([^)]*\)\s*$/, "") // drop a trailing "(...)" qualifier, e.g. dual-building Hammersmith
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/['’.]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

// Wikipedia's "Underground station gained step-free access" table: a
// citation-heavy history of accessibility retrofits, used only to fill the
// gap where TfL's own API omits LRAD data (hub/interchange stations).
async function fetchWikipediaStepFreeStationNames(): Promise<Set<string>> {
	const res = await fetch(
		"https://en.wikipedia.org/w/index.php?title=Accessibility_of_transport_in_London&action=raw"
	);
	if (!res.ok) throw new Error(`wikipedia fetch -> ${res.status}`);
	const wikitext = await res.text();
	const lines = wikitext.split("\n");

	const start = lines.findIndex((l) => l.trim() === '{| class="wikitable"');
	const tableLines: string[] = [];
	for (let i = start; i < lines.length; i++) {
		tableLines.push(lines[i]);
		if (lines[i].trim() === "|}") break;
	}
	let tableText = tableLines.join("\n");
	// Strip citation refs before extracting links - self-closing refs must go
	// first, since the paired-ref regex would otherwise treat a self-closing
	// <ref .../> as an unclosed opening tag and swallow everything up to the
	// next unrelated </ref>.
	tableText = tableText.replace(/<ref[^>]*\/>/g, "");
	tableText = tableText.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "");

	const names = new Set<string>();
	const linkRe = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
	let m: RegExpExecArray | null;
	while ((m = linkRe.exec(tableText))) {
		let name = (m[2] || m[1]).trim();
		name = name.replace(/\s+tube station.*$/i, "");
		name = name.replace(/\s+station\s*\(.*$/i, "");
		name = name.replace(/\s+underground station$/i, "");
		if (/^[a-z].*\sstation$/i.test(name) && !/power station/i.test(name)) {
			name = name.replace(/\s+station$/i, "");
		}
		if (name === "Elizabeth line") continue; // stray non-station wikilink in the prose
		names.add(normalizeStationName(name));
	}
	return names;
}

async function fetchLineAdjacency(): Promise<Map<string, Set<string>>> {
	const adjacency = new Map<string, Set<string>>();
	const addEdge = (a: string, b: string) => {
		if (!adjacency.has(a)) adjacency.set(a, new Set());
		if (!adjacency.has(b)) adjacency.set(b, new Set());
		adjacency.get(a)!.add(b);
		adjacency.get(b)!.add(a);
	};

	for (const lineId of TUBE_LINES) {
		for (const direction of ["outbound", "inbound"] as const) {
			const seq = await fetchJson<TflLineSequence>(
				`https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/${direction}`
			);
			for (const route of seq.orderedLineRoutes) {
				for (let i = 0; i < route.naptanIds.length - 1; i++) {
					addEdge(route.naptanIds[i], route.naptanIds[i + 1]);
				}
			}
		}
	}
	return adjacency;
}

function haversineMetres(a: TflStopPoint, b: TflStopPoint): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(b.lat - a.lat);
	const dLon = toRad(b.lon - a.lon);
	const lat1 = toRad(a.lat);
	const lat2 = toRad(b.lat);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestStepFreeStation(
	stationId: string,
	stepFreeStationIds: Set<string>,
	adjacency: Map<string, Set<string>>,
	stationsById: Map<string, TflStopPoint>
): { nearestId: string; hops: number; distanceM: number } | null {
	// BFS along the tube network graph first (a real, walkable route).
	const visited = new Set<string>([stationId]);
	let frontier = [stationId];
	let hops = 0;
	while (frontier.length > 0) {
		hops++;
		const next: string[] = [];
		for (const id of frontier) {
			for (const neighbour of adjacency.get(id) ?? []) {
				if (visited.has(neighbour)) continue;
				visited.add(neighbour);
				if (stepFreeStationIds.has(neighbour)) {
					return {
						nearestId: neighbour,
						hops,
						distanceM: haversineMetres(stationsById.get(stationId)!, stationsById.get(neighbour)!)
					};
				}
				next.push(neighbour);
			}
		}
		frontier = next;
	}

	// Fallback: straight-line distance to any step-free station (e.g. isolated branch).
	const origin = stationsById.get(stationId);
	if (!origin) return null;
	let best: { nearestId: string; distanceM: number } | null = null;
	for (const candidateId of stepFreeStationIds) {
		const candidate = stationsById.get(candidateId);
		if (!candidate) continue;
		const distanceM = haversineMetres(origin, candidate);
		if (!best || distanceM < best.distanceM) best = { nearestId: candidateId, distanceM };
	}
	return best ? { ...best, hops: -1 } : null;
}

async function main() {
	console.log("Fetching station list...");
	const stations = await fetchStationList();
	const stationsById = new Map(stations.map((s) => [s.naptanId, s]));
	console.log(`  ${stations.length} tube stations`);

	console.log("Fetching line sequences for adjacency graph...");
	const adjacency = await fetchLineAdjacency();

	console.log("Fetching Wikipedia step-free access history (fallback for hub stations)...");
	const wikipediaStepFreeNames = await fetchWikipediaStepFreeStationNames();

	console.log(
		`Fetching per-station accessibility flags (${stations.length} requests, concurrency ${INDIVIDUAL_FETCH_CONCURRENCY})...`
	);
	const lradResults = await mapWithConcurrency(stations, INDIVIDUAL_FETCH_CONCURRENCY, (station) =>
		fetchLradStepFree(station.naptanId)
	);

	let lradCount = 0;
	let fallbackCount = 0;
	const stepFreeStationIds = new Set<string>();
	for (let i = 0; i < stations.length; i++) {
		const station = stations[i];
		const lradValue = lradResults[i];
		if (lradValue !== null) {
			lradCount++;
			if (lradValue) stepFreeStationIds.add(station.naptanId);
			continue;
		}
		fallbackCount++;
		if (wikipediaStepFreeNames.has(normalizeStationName(station.commonName))) {
			stepFreeStationIds.add(station.naptanId);
		}
	}
	console.log(
		`  ${stepFreeStationIds.size} step-free stations (${lradCount} from TfL LRAD data, ${fallbackCount} used the Wikipedia fallback)`
	);

	console.log("Computing nearest step-free station for the rest...");
	const nearest = new Map<string, { nearestId: string; hops: number; distanceM: number }>();
	for (const station of stations) {
		if (stepFreeStationIds.has(station.naptanId)) continue;
		const result = nearestStepFreeStation(
			station.naptanId,
			stepFreeStationIds,
			adjacency,
			stationsById
		);
		if (result) nearest.set(station.naptanId, result);
	}

	console.log("Writing seed.sqlite...");
	mkdirSync(dirname(SEED_DB_PATH), { recursive: true });
	writeFileSync(SEED_DB_PATH, ""); // truncate/create so better-sqlite3 opens a fresh file
	const db = new Database(SEED_DB_PATH);

	db.exec(`
		CREATE TABLE stations (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			lat REAL NOT NULL,
			lon REAL NOT NULL,
			has_step_free INTEGER NOT NULL
		);
		CREATE TABLE lines (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL
		);
		CREATE TABLE station_lines (
			station_id TEXT NOT NULL REFERENCES stations(id),
			line_id TEXT NOT NULL REFERENCES lines(id),
			PRIMARY KEY (station_id, line_id)
		);
		CREATE TABLE nearest_step_free (
			station_id TEXT PRIMARY KEY REFERENCES stations(id),
			nearest_station_id TEXT NOT NULL REFERENCES stations(id),
			hops INTEGER NOT NULL,
			distance_m REAL NOT NULL
		);
		CREATE TABLE lift_disruptions (
			station_id TEXT NOT NULL,
			lift_id TEXT NOT NULL,
			message TEXT NOT NULL,
			fetched_at TEXT NOT NULL
		);
		CREATE TABLE line_disruptions (
			line_id TEXT NOT NULL,
			description TEXT NOT NULL,
			category TEXT NOT NULL,
			fetched_at TEXT NOT NULL
		);
		CREATE TABLE meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);

	const insertStation = db.prepare(
		"INSERT INTO stations (id, name, lat, lon, has_step_free) VALUES (?, ?, ?, ?, ?)"
	);
	const insertLine = db.prepare("INSERT OR IGNORE INTO lines (id, name) VALUES (?, ?)");
	const insertStationLine = db.prepare(
		"INSERT INTO station_lines (station_id, line_id) VALUES (?, ?)"
	);
	const insertNearest = db.prepare(
		"INSERT INTO nearest_step_free (station_id, nearest_station_id, hops, distance_m) VALUES (?, ?, ?, ?)"
	);
	const insertMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");

	const tx = db.transaction(() => {
		for (const station of stations) {
			insertStation.run(
				station.naptanId,
				station.commonName.replace(/ Underground Station$/, ""),
				station.lat,
				station.lon,
				stepFreeStationIds.has(station.naptanId) ? 1 : 0
			);
			for (const line of station.lines) {
				if (!(TUBE_LINES as readonly string[]).includes(line.id)) continue;
				insertLine.run(line.id, line.name);
				insertStationLine.run(station.naptanId, line.id);
			}
		}
		for (const [stationId, result] of nearest) {
			insertNearest.run(stationId, result.nearestId, result.hops, result.distanceM);
		}
		insertMeta.run("seed_version", new Date().toISOString());
	});
	tx();

	db.close();
	console.log(`Done. Wrote ${SEED_DB_PATH}`);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
