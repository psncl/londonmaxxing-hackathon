// The page is entirely client-driven after load (station lookup runs against
// the client-side sql.js database, not server data), so it can be prerendered
// to a static shell. That shell is what the service worker precaches and
// serves for navigations while offline - without it there's no HTML for the
// service worker to fall back to.
export const prerender = true;
