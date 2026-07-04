// TfL's official line colours (per the Tube map / brand guidelines).
export const LINE_COLORS: Record<string, string> = {
	bakerloo: "#B36305",
	central: "#E32017",
	circle: "#FFD300",
	district: "#00782A",
	"hammersmith-city": "#F3A9BB",
	jubilee: "#A0A5A9",
	metropolitan: "#9B0056",
	northern: "#000000",
	piccadilly: "#003688",
	victoria: "#0098D4",
	"waterloo-city": "#95CDBA"
};

// Lines whose background is light enough that white text fails contrast.
const DARK_TEXT_LINES = new Set(["circle", "hammersmith-city", "jubilee", "waterloo-city"]);

export function lineTextColor(lineId: string): string {
	return DARK_TEXT_LINES.has(lineId) ? "#0b0c0c" : "#ffffff";
}
