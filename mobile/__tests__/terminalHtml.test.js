import { getTerminalHTML, startTerminalScript, toWsUrl, terminalAssetUrl } from "../src/terminalHtml";

const SERVER = "http://100.64.0.1:2000";

describe("terminal page", () => {
  test("the HTML contains no WebSocket address and no PIN placeholder", () => {
    const html = getTerminalHTML(SERVER);
    expect(html).not.toMatch(/\?pin=/);
    expect(html).not.toMatch(/ws:\/\/|wss:\/\//);
    expect(html).toMatch(/window\.startTerminal = function/);
    expect(html).toMatch(/ws\.send\(JSON\.stringify\(\{ pin: cfg\.pin \}\)\)/);
  });

  test("loads xterm and the fit addon from the PC, not a CDN", () => {
    const html = getTerminalHTML(SERVER);
    expect(html).toMatch(`<link rel="stylesheet" href="${SERVER}/static/xterm.css">`);
    expect(html).toMatch(`<script src="${SERVER}/static/xterm.js"></script>`);
    expect(html).toMatch(`<script src="${SERVER}/static/addon-fit.js"></script>`);
    expect(html).not.toMatch(/jsdelivr|unpkg|cdnjs/);
    // Exactly three external references, all pointing at the PC.
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    expect(refs).toHaveLength(3);
    for (const ref of refs) expect(ref.startsWith(`${SERVER}/static/`)).toBe(true);
  });

  test("a trailing slash on the server address does not double up", () => {
    expect(getTerminalHTML(`${SERVER}/`)).toMatch(`"${SERVER}/static/xterm.js"`);
    expect(terminalAssetUrl(`${SERVER}//`, "xterm.css")).toBe(`${SERVER}/static/xterm.css`);
  });

  test("the server address is escaped inside attributes", () => {
    const html = getTerminalHTML('http://pc:2000"><script>evil()</script>');
    expect(html).not.toMatch(/<script>evil\(\)<\/script>/);
    expect(html).toMatch(/&quot;&gt;&lt;script&gt;evil\(\)&lt;\/script&gt;/);
  });

  test("reports when xterm assets could not load instead of hanging", () => {
    expect(getTerminalHTML(SERVER)).toMatch(/post\('assets_failed'\)/);
  });

  test("close code 4001 is surfaced as an auth failure", () => {
    expect(getTerminalHTML(SERVER)).toMatch(/e\.code === 4001/);
  });
});

describe("toWsUrl", () => {
  test.each([
    ["http://100.64.0.1:2000", "ws://100.64.0.1:2000"],
    ["https://venom.tailnet.ts.net:2000/", "wss://venom.tailnet.ts.net:2000"],
    ["HTTP://host:2000", "ws://host:2000"],
  ])("%s -> %s", (input, expected) => {
    expect(toWsUrl(input)).toBe(expected);
  });
});

describe("startTerminalScript", () => {
  test("passes address and PIN as JSON", () => {
    const js = startTerminalScript({ wsUrl: "ws://pc:2000", pin: "s3cret" });
    expect(js).toBe('window.startTerminal({"wsUrl":"ws://pc:2000","pin":"s3cret"}); true;');
  });

  test("a hostile password cannot break out of the call", () => {
    const pin = `x'); alert(1); //</script><script>evil()</script>\\"\n `;
    const js = startTerminalScript({ wsUrl: "ws://pc:2000", pin });
    // Whatever the password contains, the script must still be exactly one call
    // with a JSON literal argument that parses back to the same values.
    const m = js.match(/^window\.startTerminal\((.*)\); true;$/s);
    expect(m).not.toBeNull();
    expect(JSON.parse(m[1])).toEqual({ wsUrl: "ws://pc:2000", pin });
    expect(js).not.toMatch(/<\/script>/);
  });
});
