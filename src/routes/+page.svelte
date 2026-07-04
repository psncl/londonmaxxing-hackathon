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

<main class="govuk-main-wrapper">
	<h1 class="govuk-heading-l">Step-free Tube lookup</h1>

	{#if loadError}
		<p class="govuk-error-message">{loadError}</p>
	{:else if !db}
		<p class="govuk-hint">Loading station data…</p>
	{:else}
		<div class="govuk-form-group">
			<label class="govuk-label" for="station-search">Station name</label>
			<input
				id="station-search"
				class="govuk-input"
				type="text"
				inputmode="search"
				placeholder="Enter a station name…"
				bind:value={search}
				oninput={onSearchInput}
			/>
		</div>

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
				<h2 class="govuk-heading-m">{selected.name}</h2>

				{#if selected.hasStepFree}
					<strong class="govuk-tag govuk-tag--green">Step-free access</strong>
				{:else}
					<strong class="govuk-tag govuk-tag--red">Not step-free</strong>
					{#if selected.nearestStepFree}
						<p class="govuk-hint">
							Nearest step-free station: <strong>{selected.nearestStepFree.name}</strong>
							({Math.round(selected.nearestStepFree.distanceM)}m away)
						</p>
					{/if}
				{/if}

				<h3 class="govuk-heading-s">Lines</h3>
				<ul class="lines">
					{#each selected.lines as line (line.id)}
						<li>{line.name}</li>
					{/each}
				</ul>

				<h3 class="govuk-heading-s">Lift &amp; escalator disruptions</h3>
				{#if liftDisruptions.length > 0}
					<ul class="disruptions">
						{#each liftDisruptions as d (d.liftId)}
							<li>{d.message}</li>
						{/each}
					</ul>
				{:else}
					<p class="govuk-hint">None reported.</p>
				{/if}

				{#if lineDisruptions.length > 0}
					<h3 class="govuk-heading-s">Line disruptions</h3>
					<ul class="disruptions">
						{#each lineDisruptions as d (d.lineId + d.description)}
							<li>{d.description}</li>
						{/each}
					</ul>
				{/if}

				{#if lastSynced}
					<p class="synced">
						<strong class="govuk-tag govuk-tag--grey">
							{syncing ? "Updating…" : `Last updated ${formatSynced(lastSynced)}`}
						</strong>
					</p>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	:global(body) {
		font-family:
			"GDS Transport", arial, sans-serif;
		color: #0b0c0c;
		background: #ffffff;
	}

	.govuk-main-wrapper {
		max-width: 28rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.govuk-heading-l {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 1.25rem;
	}

	.govuk-heading-m {
		font-size: 1.25rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
	}

	.govuk-heading-s {
		font-size: 1rem;
		font-weight: 700;
		margin: 2rem 0 0.5rem;
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

	.matches {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		border: 1px solid #b1b4b6;
	}

	.matches button {
		width: 100%;
		text-align: left;
		padding: 0.75rem;
		border: none;
		background: none;
		font-size: 1rem;
		font-family: inherit;
		border-bottom: 1px solid #b1b4b6;
		cursor: pointer;
	}

	.matches button:hover {
		background: #f3f2f1;
	}

	.matches li:last-child button {
		border-bottom: none;
	}

	.result {
		margin-top: 1.5rem;
		border-top: 1px solid #b1b4b6;
		padding-top: 1rem;
	}

	.govuk-tag {
		display: inline-block;
		font-size: 0.875rem;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		padding: 0.3rem 0.6rem;
	}

	.govuk-tag--green {
		background: #00703c;
		color: #ffffff;
	}

	.govuk-tag--red {
		background: #d4351c;
		color: #ffffff;
	}

	.govuk-tag--grey {
		background: #eeefef;
		color: #383f43;
	}

	.govuk-hint,
	.synced {
		color: #505a5f;
		font-size: 0.9rem;
	}

	.govuk-error-message {
		color: #d4351c;
		font-weight: 700;
	}

	.lines,
	.disruptions {
		padding-left: 1.25rem;
		margin: 0.25rem 0;
	}

	.synced {
		margin-top: 2rem;
		text-align: right;
	}
</style>
