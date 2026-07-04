import type { Database, SqlValue } from "sql.js";

export interface StationMatch {
	id: string;
	name: string;
}

export interface LineInfo {
	id: string;
	name: string;
}

export interface NearestStepFreeStation {
	id: string;
	name: string;
	distanceM: number;
}

export interface StationDetail {
	id: string;
	name: string;
	hasStepFree: boolean;
	lines: LineInfo[];
	nearestStepFree: NearestStepFreeStation | null;
}

export interface LiftDisruption {
	liftId: string;
	message: string;
	fetchedAt: string;
}

export interface LineDisruption {
	lineId: string;
	description: string;
	category: string;
	fetchedAt: string;
}

export interface StationDisruptionRow {
	stationId: string;
	stationName: string;
	type: "lift" | "line";
	lineOrLiftId: string;
	lineName: string | null;
	detail: string;
	fetchedAt: string;
}

function queryAll(db: Database, sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
	const stmt = db.prepare(sql);
	stmt.bind(params);
	const rows: Record<string, SqlValue>[] = [];
	while (stmt.step()) rows.push(stmt.getAsObject());
	stmt.free();
	return rows;
}

// Case-insensitive substring match on station name, e.g. "green pk" won't
// match but "green par" will - good enough for a single mobile text input.
export function findStations(db: Database, search: string, limit = 8): StationMatch[] {
	const term = search.trim();
	if (!term) return [];
	const rows = queryAll(
		db,
		"SELECT id, name FROM stations WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?",
		[`%${term}%`, limit]
	);
	return rows.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export function getStationDetail(db: Database, stationId: string): StationDetail | null {
	const stationRows = queryAll(db, "SELECT * FROM stations WHERE id = ?", [stationId]);
	if (stationRows.length === 0) return null;
	const station = stationRows[0];

	const lineRows = queryAll(
		db,
		`SELECT l.id, l.name FROM station_lines sl
		 JOIN lines l ON l.id = sl.line_id
		 WHERE sl.station_id = ?
		 ORDER BY l.name`,
		[stationId]
	);
	const lines = lineRows.map((r) => ({ id: String(r.id), name: String(r.name) }));

	const hasStepFree = Number(station.has_step_free) === 1;
	let nearestStepFree: NearestStepFreeStation | null = null;
	if (!hasStepFree) {
		const nearestRows = queryAll(
			db,
			`SELECT s.id, s.name, n.distance_m FROM nearest_step_free n
			 JOIN stations s ON s.id = n.nearest_station_id
			 WHERE n.station_id = ?`,
			[stationId]
		);
		if (nearestRows.length > 0) {
			nearestStepFree = {
				id: String(nearestRows[0].id),
				name: String(nearestRows[0].name),
				distanceM: Number(nearestRows[0].distance_m)
			};
		}
	}

	return {
		id: String(station.id),
		name: String(station.name),
		hasStepFree,
		lines,
		nearestStepFree
	};
}

export function getAllLineIds(db: Database): string[] {
	return queryAll(db, "SELECT id FROM lines").map((r) => String(r.id));
}

export function getLiftDisruptions(db: Database, stationId: string): LiftDisruption[] {
	const rows = queryAll(
		db,
		"SELECT lift_id, message, fetched_at FROM lift_disruptions WHERE station_id = ? ORDER BY fetched_at DESC",
		[stationId]
	);
	return rows.map((r) => ({
		liftId: String(r.lift_id),
		message: String(r.message),
		fetchedAt: String(r.fetched_at)
	}));
}

export function getLineDisruptions(db: Database, lineIds: string[]): LineDisruption[] {
	if (lineIds.length === 0) return [];
	const placeholders = lineIds.map(() => "?").join(",");
	const rows = queryAll(
		db,
		`SELECT line_id, description, category, fetched_at FROM line_disruptions
		 WHERE line_id IN (${placeholders}) ORDER BY fetched_at DESC`,
		lineIds
	);
	return rows.map((r) => ({
		lineId: String(r.line_id),
		description: String(r.description),
		category: String(r.category),
		fetchedAt: String(r.fetched_at)
	}));
}

// All cached disruptions across every station, for the disruptions table view.
// Lift disruptions are station-specific (station_id on the row). Line
// disruptions have no station_id in the schema, so they're expanded via
// station_lines to every station served by the affected line - "type" is kept
// on each row so a table can distinguish "this station's lift is broken" from
// "this station is on a line with a disruption somewhere".
export function getAllDisruptions(db: Database): StationDisruptionRow[] {
	const rows = queryAll(
		db,
		`SELECT s.id AS station_id, s.name AS station_name, 'lift' AS type,
		        ld.lift_id AS ref_id, NULL AS line_name, ld.message AS detail, ld.fetched_at
		 FROM lift_disruptions ld
		 JOIN stations s ON s.id = ld.station_id
		 UNION ALL
		 SELECT s.id AS station_id, s.name AS station_name, 'line' AS type,
		        d.line_id AS ref_id, l.name AS line_name, d.description AS detail, d.fetched_at
		 FROM line_disruptions d
		 JOIN lines l ON l.id = d.line_id
		 JOIN station_lines sl ON sl.line_id = d.line_id
		 JOIN stations s ON s.id = sl.station_id
		 ORDER BY fetched_at DESC`
	);
	return rows.map((r) => ({
		stationId: String(r.station_id),
		stationName: String(r.station_name),
		type: r.type === "lift" ? "lift" : "line",
		lineOrLiftId: String(r.ref_id),
		lineName: r.line_name == null ? null : String(r.line_name),
		detail: String(r.detail),
		fetchedAt: String(r.fetched_at)
	}));
}

// Replaces any previously cached disruption rows for these stations/lines
// with fresh ones from the server proxy, stamping fetched_at now.
export function replaceDisruptions(
	db: Database,
	stationIds: string[],
	lineIds: string[],
	liftDisruptions: { stationId: string; liftId: string; message: string }[],
	lineDisruptions: { lineId: string; description: string; category: string }[]
): void {
	const fetchedAt = new Date().toISOString();
	db.run("BEGIN");
	try {
		if (stationIds.length > 0) {
			const placeholders = stationIds.map(() => "?").join(",");
			db.run(`DELETE FROM lift_disruptions WHERE station_id IN (${placeholders})`, stationIds);
		}
		if (lineIds.length > 0) {
			const placeholders = lineIds.map(() => "?").join(",");
			db.run(`DELETE FROM line_disruptions WHERE line_id IN (${placeholders})`, lineIds);
		}
		const insertLift = db.prepare(
			"INSERT INTO lift_disruptions (station_id, lift_id, message, fetched_at) VALUES (?, ?, ?, ?)"
		);
		for (const d of liftDisruptions) {
			insertLift.run([d.stationId, d.liftId, d.message, fetchedAt]);
		}
		insertLift.free();

		const insertLine = db.prepare(
			"INSERT INTO line_disruptions (line_id, description, category, fetched_at) VALUES (?, ?, ?, ?)"
		);
		for (const d of lineDisruptions) {
			insertLine.run([d.lineId, d.description, d.category, fetchedAt]);
		}
		insertLine.free();
		db.run("COMMIT");
	} catch (err) {
		db.run("ROLLBACK");
		throw err;
	}
}

// Like replaceDisruptions, but for a network-wide sync (the disruptions
// table view) rather than a single selected station: clears every cached
// row instead of just the ones for a given station/line list, so
// disruptions that have since resolved don't linger in the cache forever.
export function replaceAllDisruptions(
	db: Database,
	liftDisruptions: { stationId: string; liftId: string; message: string }[],
	lineDisruptions: { lineId: string; description: string; category: string }[]
): void {
	const fetchedAt = new Date().toISOString();
	db.run("BEGIN");
	try {
		db.run("DELETE FROM lift_disruptions");
		db.run("DELETE FROM line_disruptions");

		const insertLift = db.prepare(
			"INSERT INTO lift_disruptions (station_id, lift_id, message, fetched_at) VALUES (?, ?, ?, ?)"
		);
		for (const d of liftDisruptions) {
			insertLift.run([d.stationId, d.liftId, d.message, fetchedAt]);
		}
		insertLift.free();

		const insertLine = db.prepare(
			"INSERT INTO line_disruptions (line_id, description, category, fetched_at) VALUES (?, ?, ?, ?)"
		);
		for (const d of lineDisruptions) {
			insertLine.run([d.lineId, d.description, d.category, fetchedAt]);
		}
		insertLine.free();
		db.run("COMMIT");
	} catch (err) {
		db.run("ROLLBACK");
		throw err;
	}
}
