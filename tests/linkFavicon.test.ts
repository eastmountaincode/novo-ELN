import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));

type ResponseSpec = { status?: number; location?: string; html?: string; contentType?: string };
function responses(...specs: ResponseSpec[]) {
  for (const spec of specs) {
    mocks.request.mockImplementationOnce((_url, _options, receive) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = Object.assign(new PassThrough(), {
          statusCode: spec.status ?? 200,
          headers: { "content-type": spec.contentType ?? "text/html; charset=utf-8", location: spec.location },
        });
        receive(response);
        response.end(spec.html ?? "<head></head>");
      };
      return request;
    });
  }
}

beforeEach(() => {
  vi.resetModules();
  mocks.lookup.mockReset().mockResolvedValue([{ address: "155.52.206.45", family: 4 }]);
  mocks.request.mockReset();
});

describe("shared link favicons", () => {
  it("uses a declared custom icon, resolves relative paths and entities, and prefers icon over touch icon", async () => {
    const { faviconFromHtml } = await import("../src/lib/linkFavicon");
    expect(faviconFromHtml('<head><link rel="icon" href="/oligo-workbench/oligo-workbench-mark.png"></head>', "https://ccibweb2.mgh.harvard.edu/oligo-workbench/")).toBe("https://ccibweb2.mgh.harvard.edu/oligo-workbench/oligo-workbench-mark.png");
    expect(faviconFromHtml('<head><base href="/assets/"><link rel="apple-touch-icon" href="touch.png"><link rel="shortcut ICON" href="icon.png?one=1&amp;two=2"></head>', "https://example.com/docs/page")).toBe("https://example.com/assets/icon.png?one=1&two=2");
    expect(faviconFromHtml("<head><link rel=icon href=icon.svg></head>", "https://example.com/app/")).toBe("https://example.com/app/icon.svg");
  });

  it("falls back to the standard favicon and ignores unsafe or non-head declarations", async () => {
    const { faviconFromHtml } = await import("../src/lib/linkFavicon");
    for (const html of ["", '<head><!-- <link rel="icon" href="ignored.png"> --></head>', '<head><script>const text = \'<link rel="icon" href="ignored.png">\';</script></head>', '<head></head><body><link rel="icon" href="ignored.png"></body>', '<link rel="icon" href="javascript:alert(1)">', '<link rel="icon" href="https://user:password@example.com/private.png">']) {
      expect(faviconFromHtml(html, "https://example.com/app/")).toBe("https://example.com/favicon.ico");
    }
  });

  it("rejects loopback, private, link-local, reserved, and IPv6 endpoints", async () => {
    const { isPublicFaviconAddress } = await import("../src/lib/linkFavicon");
    for (const address of ["0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1", "fd00::1", "not-an-address"]) {
      expect(isPublicFaviconAddress(address), address).toBe(false);
    }
    expect(isPublicFaviconAddress("155.52.206.45")).toBe(true);
  });

  it("pins the validated address and coalesces repeated lookups", async () => {
    responses({ html: '<head><link rel="icon" href="/custom.png"></head>' });
    const { resolveLinkFavicon } = await import("../src/lib/linkFavicon");
    const first = resolveLinkFavicon("https://example.com/app/");
    expect(resolveLinkFavicon("https://example.com/app/")).toBe(first);
    expect(await first).toBe("https://example.com/custom.png");
    const options = mocks.request.mock.calls[0][1];
    const pinned = vi.fn();
    options.lookup("example.com", {}, pinned);
    expect(pinned).toHaveBeenCalledWith(null, "155.52.206.45", 4);
    expect(options.agent).toBe(false);
    expect(options.headers.Cookie).toBeUndefined();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("rechecks redirect targets and never requests a private destination", async () => {
    responses({ status: 302, location: "http://127.0.0.1/admin" });
    mocks.lookup.mockResolvedValueOnce([{ address: "155.52.206.45", family: 4 }]).mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const { resolveLinkFavicon } = await import("../src/lib/linkFavicon");
    expect(await resolveLinkFavicon("https://example.com/")).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("rejects private icon URLs and mixed public/private DNS responses", async () => {
    responses({ html: '<link rel="icon" href="http://private.test/icon.png">' });
    mocks.lookup.mockResolvedValueOnce([{ address: "155.52.206.45", family: 4 }]).mockResolvedValueOnce([{ address: "192.168.1.2", family: 4 }]);
    const { resolveLinkFavicon } = await import("../src/lib/linkFavicon");
    expect(await resolveLinkFavicon("https://example.com/")).toBeNull();
    mocks.lookup.mockResolvedValueOnce([{ address: "155.52.206.45", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    expect(await resolveLinkFavicon("https://mixed.test/")).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("fails quietly on unsupported URLs, request failures, and redirect loops", async () => {
    const { resolveLinkFavicon } = await import("../src/lib/linkFavicon");
    for (const url of ["file:///etc/passwd", "http://example.com:3155/", "https://user:password@example.com/"]) {
      expect(await resolveLinkFavicon(url)).toBeNull();
    }
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.request.mockImplementationOnce(() => { throw new Error("Connection failed"); });
    expect(await resolveLinkFavicon("https://failed.test/")).toBeNull();
    responses(...Array.from({ length: 4 }, () => ({ status: 302, location: "/loop" })));
    expect(await resolveLinkFavicon("https://loop.test/")).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(5);
  });
});
