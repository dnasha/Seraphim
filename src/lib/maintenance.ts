import { get } from "@vercel/edge-config";
import { NextResponse, type NextRequest } from "next/server";

export const MAINTENANCE_MODE_KEY = "isInMaintenanceMode";
export const MAINTENANCE_LOGO_PATH = "/seraphim_logo.svg";

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="theme-color" content="#07080d">
  <title>Seraphim Maintenance</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; overflow: hidden; color: #f7f7fb; background: #07080d; }
    body::before { content: ""; position: fixed; inset: -35%; pointer-events: none; background: radial-gradient(circle at 50% 45%, rgba(99,102,241,.18), transparent 34%), radial-gradient(circle at 68% 28%, rgba(139,92,246,.08), transparent 25%); }
    main { position: relative; width: min(100% - 2rem, 42rem); padding: 3rem 1.5rem; text-align: center; }
    .brand { display: flex; align-items: center; justify-content: center; gap: .9rem; margin: 0 auto 1.75rem; }
    .brand-logo { width: clamp(5.75rem, 13vw, 7rem); height: auto; margin-inline: -1.1rem; filter: invert(1); }
    .brand-name { margin: 0; color: #f7f7fb; font-size: clamp(2.3rem, 7vw, 4rem); font-weight: 600; line-height: 1; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(1.9rem, 5.5vw, 3.15rem); line-height: 1.06; letter-spacing: -.05em; }
    .message { max-width: 31rem; margin: 1.15rem auto 0; color: #a9abba; font-size: clamp(1rem, 2.5vw, 1.12rem); line-height: 1.7; }
    nav { display: flex; justify-content: center; gap: .65rem; margin-top: 1.9rem; }
    nav a { display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border: 1px solid rgba(255,255,255,.09); border-radius: .85rem; color: #b8bac6; background: rgba(255,255,255,.025); transition: border-color .2s ease, color .2s ease, transform .2s ease, background .2s ease; }
    nav a:hover, nav a:focus-visible { color: #fff; border-color: rgba(165,180,252,.45); background: rgba(99,102,241,.12); transform: translateY(-2px); outline: none; }
    nav svg { width: 1.15rem; height: 1.15rem; fill: currentColor; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @media (prefers-reduced-motion: reduce) { nav a { transition: none; } }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <img class="brand-logo" src="${MAINTENANCE_LOGO_PATH}" alt="">
      <p class="brand-name">Seraphim</p>
    </div>
    <h1>We’ll be right back.</h1>
    <p class="message">We’re making a few improvements to Seraphim. The live intelligence map will be available again shortly.</p>
    <nav aria-label="Seraphim social links">
      <a href="https://x.com/seraphimosint" target="_blank" rel="noopener noreferrer" aria-label="Seraphim on X">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg>
        <span class="sr-only">X</span>
      </a>
      <a href="https://github.com/dnasha/Seraphim" target="_blank" rel="noopener noreferrer" aria-label="Seraphim on GitHub">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7A11.5 11.5 0 0 0 8.36 23.1c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18A10.97 10.97 0 0 1 12 6.13c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.75.12 3.04.73.8 1.17 1.82 1.17 3.08 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.27c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
        <span class="sr-only">GitHub</span>
      </a>
      <a href="https://www.youtube.com/@seraphimosint" target="_blank" rel="noopener noreferrer" aria-label="Seraphim on YouTube">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.19a3 3 0 0 0-2.11-2.12C19.52 3.57 12 3.57 12 3.57s-7.52 0-9.39.5A3 3 0 0 0 .5 6.19 31.2 31.2 0 0 0 0 12a31.2 31.2 0 0 0 .5 5.81 3 3 0 0 0 2.11 2.12c1.87.5 9.39.5 9.39.5s7.52 0 9.39-.5a3 3 0 0 0 2.11-2.12A31.2 31.2 0 0 0 24 12a31.2 31.2 0 0 0-.5-5.81ZM9.6 15.6V8.4l6.26 3.6-6.26 3.6Z"/></svg>
        <span class="sr-only">YouTube</span>
      </a>
      <a href="https://discord.gg/rqaBsXkFmY" target="_blank" rel="noopener noreferrer" aria-label="Join Seraphim on Discord">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.51c-.21.38-.46.9-.63 1.3a18.3 18.3 0 0 0-5.58 0c-.17-.4-.43-.92-.64-1.3-1.71.29-3.35.8-4.9 1.52C.58 8.97-.26 13.44.16 17.85a19.9 19.9 0 0 0 6 3.02c.48-.66.91-1.36 1.28-2.1-.7-.26-1.37-.59-2.01-.97.17-.12.33-.25.49-.38a14.2 14.2 0 0 0 12.17 0l.49.38c-.64.38-1.32.71-2.01.97.37.74.8 1.44 1.28 2.1a19.8 19.8 0 0 0 6-3.02c.49-5.11-.84-9.54-3.53-13.48ZM8.02 15.14c-1.17 0-2.13-1.08-2.13-2.4s.94-2.4 2.13-2.4c1.2 0 2.15 1.09 2.13 2.4 0 1.32-.94 2.4-2.13 2.4Zm7.96 0c-1.17 0-2.13-1.08-2.13-2.4s.94-2.4 2.13-2.4c1.2 0 2.15 1.09 2.13 2.4 0 1.32-.93 2.4-2.13 2.4Z"/></svg>
        <span class="sr-only">Discord</span>
      </a>
    </nav>
  </main>
</body>
</html>`;

/**
 * Missing configuration is safe for local development. Once a project is
 * connected to Edge Config, read failures fail closed so a broken flag read
 * cannot reopen a site that was deliberately taken offline.
 */
export async function isMaintenanceMode() {
  if (!process.env.EDGE_CONFIG) return false;

  try {
    return (await get<boolean>(MAINTENANCE_MODE_KEY)) === true;
  } catch (error) {
    console.error("[maintenance] Edge Config read failed; failing closed.", error);
    return true;
  }
}

export function createMaintenanceResponse(request: NextRequest) {
  return new NextResponse(request.method === "HEAD" ? null : MAINTENANCE_HTML, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "3600",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Maintenance-Mode": "true",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
