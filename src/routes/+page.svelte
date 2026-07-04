<script lang="ts">
	import { onMount } from "svelte";
	import type { Database } from "sql.js";
	import { getDb } from "$lib/db";
	import {
		findStations,
		getStationDetail,
		getLiftDisruptions,
		getLineDisruptions,
		replaceDisruptions,
		type StationMatch,
		type StationDetail,
		type LiftDisruption,
		type LineDisruption
	} from "$lib/data/queries";

	let db = $state<Database | null>(null);
	let loadError = $state<string | null>(null);

	let search = $state("");
	let matches = $state<StationMatch[]>([]);
	let selected = $state<StationDetail | null>(null);
	let liftDisruptions = $state<LiftDisruption[]>([]);
	let lineDisruptions = $state<LineDisruption[]>([]);
	let lastSynced = $state<string | null>(null);
	let syncing = $state(false);

	onMount(async () => {
		try {
			db = await getDb();
		} catch {
			loadError = "Couldn't load station data. Try again once you're online.";
		}
	});

	function onSearchInput() {
		if (!db) return;
		matches = search.trim() ? findStations(db, search) : [];
	}

	function refreshDisruptionsFromCache() {
		if (!db || !selected) return;
		liftDisruptions = getLiftDisruptions(db, selected.id);
		lineDisruptions = getLineDisruptions(
			db,
			selected.lines.map((l) => l.id)
		);
		lastSynced = liftDisruptions[0]?.fetchedAt ?? lineDisruptions[0]?.fetchedAt ?? null;
	}

	async function syncLiveDisruptions(station: StationDetail) {
		if (!db) return;
		syncing = true;
		try {
			const lineIds = station.lines.map((l) => l.id).join(",");
			const res = await fetch(`/api/disruptions?stationIds=${station.id}&lineIds=${lineIds}`);
			if (res.ok) {
				const data = await res.json();
				replaceDisruptions(
					db,
					[station.id],
					station.lines.map((l) => l.id),
					data.liftDisruptions ?? [],
					data.lineDisruptions ?? []
				);
				refreshDisruptionsFromCache();
			}
		} catch {
			// Offline or TfL unreachable - keep showing whatever was already cached.
		} finally {
			syncing = false;
		}
	}

	function selectStation(stationId: string) {
		if (!db) return;
		matches = [];
		search = "";
		selected = getStationDetail(db, stationId);
		liftDisruptions = [];
		lineDisruptions = [];
		lastSynced = null;
		if (!selected) return;
		refreshDisruptionsFromCache();
		if (navigator.onLine) void syncLiveDisruptions(selected);
	}

	function formatSynced(iso: string | null): string {
		if (!iso) return "";
		return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
</script>

<main>
	<h1>Step-free Tube lookup</h1>

	{#if loadError}
		<p class="error">{loadError}</p>
	{:else if !db}
		<p class="hint">Loading station data…</p>
	{:else}
		<input
			type="text"
			inputmode="search"
			placeholder="Enter a station name…"
			bind:value={search}
			oninput={onSearchInput}
			aria-label="Station name"
		/>

		{#if matches.length > 0}
			<ul class="matches">
				{#each matches as match (match.id)}
					<li>
						<button type="button" onclick={() => selectStation(match.id)}>{match.name}</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if selected}
			<section class="result">
				<h2>{selected.name}</h2>

				{#if selected.hasStepFree}
					<p class="status ok">✓ Step-free access</p>
				{:else}
					<p class="status no">✗ Not step-free</p>
					{#if selected.nearestStepFree}
						<p class="hint">
							Nearest step-free station: <strong>{selected.nearestStepFree.name}</strong>
							({Math.round(selected.nearestStepFree.distanceM)}m away)
						</p>
					{/if}
				{/if}

				<h3>Lines</h3>
				<ul class="lines">
					{#each selected.lines as line (line.id)}
						<li>{line.name}</li>
					{/each}
				</ul>

				<h3>Lift &amp; escalator disruptions</h3>
				{#if liftDisruptions.length > 0}
					<ul class="disruptions">
						{#each liftDisruptions as d (d.liftId)}
							<li>{d.message}</li>
						{/each}
					</ul>
				{:else}
					<p class="hint">None reported.</p>
				{/if}

				{#if lineDisruptions.length > 0}
					<h3>Line disruptions</h3>
					<ul class="disruptions">
						{#each lineDisruptions as d (d.lineId + d.description)}
							<li>{d.description}</li>
						{/each}
					</ul>
				{/if}

				{#if lastSynced}
					<p class="synced">{syncing ? "Updating…" : `Last updated ${formatSynced(lastSynced)}`}</p>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 28rem;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
	}

	h1 {
		font-size: 1.25rem;
		margin-bottom: 1rem;
	}

	input {
		width: 100%;
		font-size: 1rem;
		padding: 0.75rem;
		box-sizing: border-box;
		border: 1px solid #999;
		border-radius: 0.5rem;
	}

	.matches {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		border: 1px solid #ddd;
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.matches button {
		width: 100%;
		text-align: left;
		padding: 0.75rem;
		border: none;
		background: none;
		font-size: 1rem;
		border-bottom: 1px solid #eee;
	}

	.matches li:last-child button {
		border-bottom: none;
	}

	.result {
		margin-top: 1.5rem;
	}

	.status {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.status.ok {
		color: #0a7a2f;
	}

	.status.no {
		color: #b3261e;
	}

	.hint,
	.synced {
		color: #666;
		font-size: 0.9rem;
	}

	.error {
		color: #b3261e;
	}

	.lines,
	.disruptions {
		padding-left: 1.25rem;
	}

	.synced {
		margin-top: 1rem;
	}
</style>
