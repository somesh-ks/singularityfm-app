import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A static server for the admin's browser suite. It serves the build under /admin, the way the
 * reader's rewrite reaches it in production, with the headers the page gets there: the reader's
 * vercel.json (its Content-Security-Policy, so a violation fails a test) and this app's own. The data
 * routes are the reader's or this app's functions and are not served: the tests answer them.
 * shortcut: the reader's headers are read from its folder in this repository; when the admin moves
 * to its own (D382 step 5), carry the policy into the admin's vercel.json and read only that.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BASE = "/admin";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function loadHeaderRules() {
  const configs = [join(HERE, "..", "..", "web", "vercel.json"), join(HERE, "..", "vercel.json")];
  const rules = configs.flatMap((file) => JSON.parse(readFileSync(file, "utf8")).headers ?? []);
  return rules.map((rule) => ({
    // vercel.json sources use "(.*)" as a wildcard. Swap it out first so its own dot is not escaped.
    pattern: new RegExp(
      `^${rule.source.replaceAll("(.*)", "*").replaceAll(".", "\\.").replaceAll("*", ".*")}$`,
    ),
    headers: rule.headers,
  }));
}

/**
 * @param {{
 *   root: string,
 *   port: number,
 *   api?: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, pathname: string) => boolean,
 * }} options
 */
export function startServer({ root, port, api }) {
  const rules = loadHeaderRules();

  function headersFor(pathname) {
    const headers = {};
    for (const rule of rules) {
      if (!rule.pattern.test(pathname)) continue;
      for (const { key, value } of rule.headers) headers[key] = value;
    }
    return headers;
  }

  function resolveFile(pathname) {
    if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) return null;
    const clean = normalize(decodeURIComponent(pathname.slice(BASE.length) || "/")).replace(
      /^([/\\])+/,
      "",
    );
    const target = join(root, clean);
    if (!target.startsWith(root)) return null;
    for (const candidate of [target, join(target, "index.html"), `${target}.html`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function send(request, response, file, status) {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const stats = statSync(file);
    response.writeHead(status, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": stats.size,
      ...headersFor(pathname),
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  }

  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    // A test that owns its server answers the routes it names (experiments.spec.ts).
    if (api?.(request, response, pathname)) return;
    if (pathname.startsWith("/api/") || pathname.startsWith(`${BASE}/api/`)) {
      response.writeHead(501, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not served by the static test server" }));
      return;
    }
    const file = resolveFile(pathname);
    if (file) {
      send(request, response, file, 200);
      return;
    }
    const notFound = join(root, "404.html");
    if (existsSync(notFound)) send(request, response, notFound, 404);
    else {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${root} at http://127.0.0.1:${port}${BASE}`);
  });
  return server;
}
