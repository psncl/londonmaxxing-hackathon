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
