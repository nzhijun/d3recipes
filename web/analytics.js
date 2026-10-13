// Optional analytics. Each provider loads only when its ID below is filled in; leave one empty to disable it.
// GoatCounter and Cloudflare are cookieless and aggregate-only, so they always run. GA4 sets a persistent cookie,
// so it is skipped for visitors who send Do Not Track / Global Privacy Control.
//
// Local / self-hosted runs (for example the offline package, or any host other than the official site) must not
// phone home to third-party analytics. Skip analytics entirely unless served from the official domain, so a
// local port or a private mirror stays fully offline and loads faster.
const OFFICIAL_ORIGIN = "https://d3recipes.github.io"; // adjust to the real official origin if it ever moves
const isLocalRun = new URL(location.href).origin !== OFFICIAL_ORIGIN;
const GOATCOUNTER_CODE = "d3recipes"; // site code, e.g. "mysite" for mysite.goatcounter.com
const CLOUDFLARE_TOKEN = "41fe222c9b2447baa75b8003fb2ff9d1"; // Cloudflare Web Analytics beacon token
const GA4_ID = "G-H1N6VS4RZ8";           // Google Analytics 4 measurement ID, e.g. "G-XXXXXXXXXX"

const gaOptOut = navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;

function addScript(src, attrs = {}) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

if (GOATCOUNTER_CODE && !isLocalRun) {
  addScript("https://gc.zgo.at/count.js", { "data-goatcounter": `https://${GOATCOUNTER_CODE}.goatcounter.com/count` });
}
if (CLOUDFLARE_TOKEN && !isLocalRun) {
  addScript("https://static.cloudflareinsights.com/beacon.min.js", { type: "module", "data-cf-beacon": JSON.stringify({ token: CLOUDFLARE_TOKEN }) });
}
if (GA4_ID && !isLocalRun && !gaOptOut) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA4_ID);
  addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
}