<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { Database } from "sql.js";
	import {
		AllCommunityModule,
		ModuleRegistry,
		createGrid,
		themeQuartz,
		type CellClickedEvent,
		type GridApi,
		type ICellRendererParams
	} from "ag-grid-community";
	import { getDb } from "$lib/db";
	import { getAllDisruptions, type StationDisruptionRow } from "$lib/data/queries";
	import { LINE_COLORS, lineTextColor } from "$lib/lineColors";

	ModuleRegistry.registerModules([AllCommunityModule]);

	// Matches the GOV.UK palette used elsewhere in the app rather than AG
	// Grid's default Quartz colours.
	const govukTheme = themeQuartz.withParams({
		accentColor: "#1d70b8",
		headerBackgroundColor: "#f3f2f1",
		headerTextColor: "#0b0c0c",
		fontFamily: "'GDS Transport', arial, sans-serif"
	});

	function escapeRegExp(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function disruptionRowId(row: StationDisruptionRow): string {
		return `${row.type}-${row.lineOrLiftId}-${row.stationId}`;
	}

	// Rows whose "Disruption" cell has been expanded to show the full
	// (wrapped) text instead of a single truncated line - toggled by click,
	// like an accordion.
	const expandedRows = new Set<string>();

	// TfL's line disruption descriptions always lead with "<Line name> Line:",
	// which is redundant once the line is shown as its own coloured tag - strip
	// it and render the tag using the line's official TfL colour instead.
	function detailCellRenderer(params: ICellRendererParams<StationDisruptionRow>): HTMLElement {
		const row = params.data;
		const expanded = row ? expandedRows.has(disruptionRowId(row)) : false;

		let text = String(params.value ?? "");
		let tag: HTMLElement | null = null;

		if (row && row.type === "line" && row.lineName) {
			const prefix = new RegExp(`^${escapeRegExp(row.lineName)}\\s*line\\s*:\\s*`, "i");
			text = text.replace(prefix, "");

			tag = document.createElement("span");
			tag.textContent = row.lineName;
			tag.style.cssText = `
				display: inline-block;
				background: ${LINE_COLORS[row.lineOrLiftId] ?? "#505a5f"};
				color: ${lineTextColor(row.lineOrLiftId)};
				font-weight: 700;
				font-size: 0.65rem;
				border-radius: 0;
				padding: 0.05rem 0.35rem;
				margin-right: 0.5rem;
				white-space: nowrap;
				vertical-align: top;
			`;
		}

		const wrapper = document.createElement("span");
		wrapper.className = expanded ? "detail-cell detail-cell--expanded" : "detail-cell";
		wrapper.title = expanded ? "Click to collapse" : "Click to show the full message";

		if (tag) wrapper.append(tag);
		wrapper.append(document.createTextNode(text));
		return wrapper;
	}

	function onDetailCellClicked(event: CellClickedEvent<StationDisruptionRow>) {
		const row = event.data;
		if (!row) return;

		const id = disruptionRowId(row);
		if (expandedRows.has(id)) {
			expandedRows.delete(id);
		} else {
			expandedRows.add(id);
		}

		gridApi?.refreshCells({ rowNodes: [event.node], columns: ["detail"], force: true });
		gridApi?.resetRowHeights();
	}

	let gridDiv = $state<HTMLDivElement | null>(null);
	let gridApi: GridApi<StationDisruptionRow> | null = null;
	let loadError = $state<string | null>(null);
	let quickFilter = $state("");

	onMount(async () => {
		let db: Database;
		try {
			db = await getDb();
		} catch {
			loadError = "Couldn't load station data. Try again once you're online.";
			return;
		}

		const rowData = getAllDisruptions(db);

		if (!gridDiv) return;
		gridApi = createGrid<StationDisruptionRow>(gridDiv, {
			theme: govukTheme,
			rowData,
			columnDefs: [
				{ field: "stationName", headerName: "Station", flex: 1.5, minWidth: 140 },
				{
					field: "type",
					headerName: "Type",
					width: 100,
					valueFormatter: (p) => (p.value === "lift" ? "Lift" : "Line")
				},
				{
					field: "detail",
					headerName: "Disruption",
					flex: 3,
					minWidth: 220,
					autoHeight: true,
					cellRenderer: detailCellRenderer,
					onCellClicked: onDetailCellClicked
				},
				{
					field: "fetchedAt",
					headerName: "Last updated",
					width: 160,
					valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString() : "")
				}
			],
			defaultColDef: {
				sortable: true,
				filter: true,
				resizable: true
			}
		});
	});

	onDestroy(() => {
		gridApi?.destroy();
	});

	function onQuickFilterInput() {
		gridApi?.setGridOption("quickFilterText", quickFilter);
	}
</script>

<main class="govuk-main-wrapper">
	<h1 class="govuk-heading-l">Current disruptions</h1>

	{#if loadError}
		<p class="govuk-error-message">{loadError}</p>
	{:else}
		<div class="govuk-form-group">
			<label class="govuk-label" for="disruption-search">Filter by station or line</label>
			<input
				id="disruption-search"
				class="govuk-input"
				type="text"
				inputmode="search"
				placeholder="e.g. King's Cross, Victoria…"
				bind:value={quickFilter}
				oninput={onQuickFilterInput}
			/>
		</div>

		<div class="grid-wrapper" bind:this={gridDiv}></div>
	{/if}
</main>

<style>
	.govuk-main-wrapper {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: "GDS Transport", arial, sans-serif;
		color: #0b0c0c;
	}

	.govuk-heading-l {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 1.25rem;
	}

	.govuk-form-group {
		margin-bottom: 1rem;
	}

	.govuk-label {
		display: block;
		font-weight: 700;
		margin-bottom: 0.3rem;
	}

	.govuk-input {
		width: 100%;
		font-size: 1rem;
		padding: 0.6rem;
		box-sizing: border-box;
		border: 2px solid #0b0c0c;
		border-radius: 0;
	}

	.govuk-input:focus {
		outline: 3px solid #ffdd00;
		outline-offset: 0;
		box-shadow: inset 0 0 0 2px #0b0c0c;
	}

	.govuk-error-message {
		color: #d4351c;
		font-weight: 700;
	}

	.grid-wrapper {
		height: 60vh;
		min-height: 24rem;
	}

	:global(.detail-cell) {
		display: block;
		width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	:global(.detail-cell--expanded) {
		white-space: normal;
		overflow: visible;
		text-overflow: clip;
		word-break: break-word;
		padding: 0.4rem 0;
	}
</style>
