// vite-plugin-pwa's ambient module declaration for this subpath isn't being
// picked up by svelte-check's per-file resolution (works fine for the actual
// Vite build, which resolves the virtual module directly) - redeclared here,
// scoped to only what this app uses.
declare module 'virtual:pwa-register/svelte' {
	export interface RegisterSWOptions {
		immediate?: boolean;
		onNeedRefresh?: () => void;
		onOfflineReady?: () => void;
		onRegisteredSW?: (swScriptUrl: string, registration?: ServiceWorkerRegistration) => void;
		onRegisterError?: (error: unknown) => void;
	}

	export function useRegisterSW(options?: RegisterSWOptions): {
		needRefresh: import('svelte/store').Writable<boolean>;
		offlineReady: import('svelte/store').Writable<boolean>;
		updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
	};
}
