import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { TFL_APP_KEY } from "$env/static/private";

// Thin server-side proxy for live disruption data. Exists because TfL's API
// doesn't reliably send CORS headers on these endpoints, and because the app
// key shouldn't be shipped to the client. The client calls this only when
// online; on failure it just keeps showing its last cached rows.

interface TflLiftDisruption {
	stationUniqueId: string;
	disruptedLiftUniqueIds: string[];
	message: string;
}

interface TflLineDisruption {
	category: string;
	description: string;
}

// TfL's Line/{ids}/Disruption doesn't tag each entry with which line it's
// for when multiple ids are requested - but the description text is always
// prefixed with the line's display name (e.g. "Piccadilly Line: ..."), so
// match against that instead of guessing.
const LINE_NAMES: Record<string, string> = {
	bakerloo: "Bakerloo",
	central: "Central",
	circle: "Circle",
	district: "District",
	"hammersmith-city": "Hammersmith & City",
	jubilee: "Jubilee",
	metropolitan: "Metropolitan",
	northern: "Northern",
	piccadilly: "Piccadilly",
	victoria: "Victoria",
	"waterloo-city": "Waterloo & City"
};

function withKey(url: string): string {
	if (!TFL_APP_KEY) return url;
	const sep = url.includes("?") ? "&" : "?";
	return `${url}${sep}app_key=${TFL_APP_KEY}`;
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const stationIds = (url.searchParams.get("stationIds") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const lineIds = (url.searchParams.get("lineIds") ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const [liftRes, lineRes] = await Promise.all([
		fetch(withKey("https://api.tfl.gov.uk/Disruptions/Lifts/v2")),
		lineIds.length > 0
			? fetch(withKey(`https://api.tfl.gov.uk/Line/${lineIds.join(",")}/Disruption`))
			: Promise.resolve(null)
	]);

	if (!liftRes.ok) {
		return json({ error: `TfL lift disruptions unavailable (${liftRes.status})` }, { status: 502 });
	}
	const allLiftDisruptions = (await liftRes.json()) as TflLiftDisruption[];
	const liftDisruptions = allLiftDisruptions
		.filter((d) => stationIds.includes(d.stationUniqueId))
		.flatMap((d) =>
			d.disruptedLiftUniqueIds.map((liftId) => ({
				stationId: d.stationUniqueId,
				liftId,
				message: d.message
			}))
		);

	let lineDisruptions: { lineId: string; description: string; category: string }[] = [];
	if (lineRes) {
		if (!lineRes.ok) {
			return json({ error: `TfL line disruptions unavailable (${lineRes.status})` }, { status: 502 });
		}
		const raw = (await lineRes.json()) as (TflLineDisruption & { $type?: string })[];
		lineDisruptions = raw.flatMap((d) => {
			const lineId = lineIds.find((id) =>
				d.description.toLowerCase().startsWith(`${LINE_NAMES[id]?.toLowerCase()} line`)
			);
			return lineId ? [{ lineId, description: d.description, category: d.category }] : [];
		});
	}

	return json({ liftDisruptions, lineDisruptions });
};
