import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter()
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			// seed.sqlite and sql-wasm.wasm are fetched at runtime (not imported
			// by the bundle), so they need to be listed explicitly to end up in
			// the precache - that's what makes the app usable with zero connectivity.
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
				additionalManifestEntries: [
					{ url: '/seed.sqlite', revision: null },
					{ url: '/sql-wasm.wasm', revision: null }
				],
				// Take control of the very first page immediately instead of
				// waiting for a second navigation - otherwise the first reload
				// after load isn't actually offline-capable yet.
				clientsClaim: true,
				skipWaiting: true
			},
			manifest: {
				name: 'Step-Free Underground',
				short_name: 'StepFree',
				start_url: '/',
				display: 'standalone',
				background_color: '#ffffff',
				theme_color: '#0019a8'
			}
		})
	]
});
