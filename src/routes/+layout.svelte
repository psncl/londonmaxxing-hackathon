<script lang="ts">
	import { onMount } from 'svelte';
	import { useRegisterSW } from 'virtual:pwa-register/svelte';
	import favicon from '$lib/assets/favicon.svg';
	import Header from '$lib/components/Header.svelte';

	let { children } = $props();

	onMount(() => {
		// Registers the precache service worker so the app (and the seed
		// database) keep working with zero connectivity after first load.
		useRegisterSW({ immediate: true });
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<Header />
{@render children()}
