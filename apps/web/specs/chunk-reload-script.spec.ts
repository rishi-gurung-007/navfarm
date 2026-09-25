import { CHUNK_RELOAD_SCRIPT } from "@/utils/chunk-reload-script";

/**
 * A tab opened before a redeploy asks for chunk names the new build no longer
 * serves. The inline script must reload once for that — and only for that —
 * and must not loop when the chunk is broken on the server too.
 */
describe("chunk reload script", () => {
  let reload: jest.Mock;
  let added: Array<[string, EventListener, unknown]>;

  beforeEach(() => {
    sessionStorage.clear();
    reload = jest.fn();
    added = [];
    // jsdom will not let window.location be replaced, so the script runs
    // against a stand-in window whose listeners land on the real one.
    const fakeWindow = {
      addEventListener: (type: string, fn: EventListener, opts?: unknown) => {
        added.push([type, fn, opts]);
        window.addEventListener(type, fn, opts as any);
      },
      location: { reload },
    };
    // eslint-disable-next-line no-new-func
    new Function("window", CHUNK_RELOAD_SCRIPT)(fakeWindow);
  });

  afterEach(() => {
    for (const [type, fn, opts] of added) window.removeEventListener(type, fn, opts as any);
  });

  const chunkError = () => {
    const err = new Error("Failed to load chunk /_next/static/chunks/2836a7bbef7f8be9.js");
    err.name = "ChunkLoadError";
    window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
  };

  it("reloads when a chunk fails to load", () => {
    chunkError();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads when a /_next/static script tag fails", () => {
    const s = document.createElement("script");
    s.src = "https://test-app.navfarm.com/_next/static/chunks/abc.js";
    document.head.appendChild(s);
    s.dispatchEvent(new Event("error"));
    expect(reload).toHaveBeenCalledTimes(1);
    s.remove();
  });

  it("does not reload twice within 30 seconds", () => {
    chunkError();
    chunkError();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores ordinary errors", () => {
    window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("x is undefined"), message: "x is undefined" }));
    expect(reload).not.toHaveBeenCalled();
  });
});
