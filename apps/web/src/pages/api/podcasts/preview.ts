import type { APIRoute } from "astro";
import { onlyGet } from "../../../server/podcasts/live";

export const prerender = false;

/**
 * The hidden switch for the podcast app while it is built (slices 1 to 8). `/api/podcasts/preview?on`
 * turns it on for this browser, `?off` turns it off; either goes back to Home. Nothing links here.
 * It is a cookie so the edge can pick the page before anything is drawn (a `has: cookie` rewrite in
 * vercel.json, added by the slice that brings the new Home), so the two bottom bars never swap on
 * screen. Slice 9 deletes it.
 */
export const PREVIEW_COOKIE = "podcasts_preview";

export const GET: APIRoute = ({ url }) => {
  const on = url.searchParams.has("on");
  if (!on && !url.searchParams.has("off")) {
    return new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const cookie = on
    ? `${PREVIEW_COOKIE}=1; Path=/; Max-Age=31536000; Secure; SameSite=Lax`
    : `${PREVIEW_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
};

export const ALL = onlyGet;
