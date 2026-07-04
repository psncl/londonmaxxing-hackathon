// Data comes entirely from the client-side sql.js database (loaded in
// onMount), so this can be prerendered to a static shell just like the root
// route - the service worker then serves that shell offline too.
export const prerender = true;
