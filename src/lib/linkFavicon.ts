import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIPv4 } from "node:net";

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");

export function isPublicFaviconAddress(address: string) {
  // Discovery uses public IPv4 endpoints only; inaccessible sites use the UI fallback.
  return isIPv4(address) && !blockedAddresses.check(address, "ipv4");
}

function pageUrl(value: string, base?: URL) {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error("Unsupported favicon URL.");
  }
  url.hash = "";
  return url;
}

function decodeAttribute(value: string) {
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
    const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}

export function faviconFromHtml(html: string, documentUrl: string): string {
  const original = pageUrl(documentUrl);
  const head = html.split(/<\/head\s*>/i)[0].replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  let base = original;
  let baseFound = false;
  const icons: { href: string; touch: boolean }[] = [];
  for (const tag of head.match(/<(?:base|link)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
    }
    if (!attributes.href) continue;
    if (/^<base\b/i.test(tag)) {
      if (!baseFound) {
        try { base = pageUrl(attributes.href, original); } catch { /* Ignore unsupported bases. */ }
        baseFound = true;
      }
      continue;
    }
    const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("icon")) icons.push({ href: attributes.href, touch: false });
    else if (rel.includes("apple-touch-icon")) icons.push({ href: attributes.href, touch: true });
  }
  for (const icon of icons.sort((a, b) => Number(a.touch) - Number(b.touch))) {
    try { return pageUrl(icon.href, base).href; } catch { /* Try the next usable icon. */ }
  }
  return new URL("/favicon.ico", original).href;
}

async function publicAddress(url: URL, deadline: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Favicon lookup timed out.")), Math.max(1, deadline - Date.now())); }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicFaviconAddress(address))) throw new Error("Unsupported favicon address.");
    return addresses[0].address;
  } finally {
    clearTimeout(timer);
  }
}

function readHead(url: URL, address: string, deadline: number): Promise<{ html: string; redirect?: string }> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      method: "GET",
      family: 4,
      agent: false,
      // Pin the checked DNS result while retaining the hostname for TLS verification.
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      headers: { Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
    }, (response) => {
      response.on("error", reject);
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        resolve({ html: "", redirect: response.headers.location });
        response.destroy();
        return;
      }
      if (response.statusCode !== 200 || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers["content-type"] ?? "")) {
        resolve({ html: "" });
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        const bounded = chunk.subarray(0, Math.max(0, 256 * 1024 - size));
        chunks.push(bounded);
        size += bounded.length;
        const html = Buffer.concat(chunks).toString("utf8");
        if (size >= 256 * 1024 || /<\/head\s*>/i.test(html)) {
          resolve({ html });
          response.destroy();
        }
      });
      response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function discoverFavicon(value: string): Promise<string | null> {
  const deadline = Date.now() + 4000;
  try {
    let url = pageUrl(value);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const address = await publicAddress(url, deadline);
      const result = await readHead(url, address, deadline);
      if (result.redirect) {
        url = pageUrl(result.redirect, url);
        continue;
      }
      const icon = pageUrl(faviconFromHtml(result.html, url.href));
      await publicAddress(icon, deadline);
      return icon.href;
    }
  } catch { /* Favicon discovery must not prevent displaying a shared link. */ }
  return null;
}

const cache = new Map<string, { expires: number; result: Promise<string | null> }>();

export function resolveLinkFavicon(url: string) {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.result;
  cache.delete(url);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  const result = discoverFavicon(url);
  cache.set(url, { expires: Date.now() + 15 * 60 * 1000, result });
  return result;
}
