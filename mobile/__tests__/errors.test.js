jest.mock("../src/components/ErrorToast", () => ({ ErrorToast: () => null }));

import { parseError } from "../src/context/ErrorContext";

describe("parseError", () => {
  test("passes a prepared apiError straight through", () => {
    const apiError = { message: "x", status: 418 };
    expect(parseError({ apiError })).toBe(apiError);
  });
  test("explains a raw fetch network failure", () => {
    const parsed = parseError(new TypeError("Network request failed"));
    expect(parsed.status).toBeNull();
    expect(parsed.message).toMatch(/Can't reach the PC/);
    expect(parsed.message).not.toMatch(/is the server running/i);
  });
  test("explains a raw timeout", () => {
    const parsed = parseError(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    expect(parsed.message).toMatch(/No answer from the PC/);
  });
  test("keeps status, method and endpoint from api() errors", () => {
    const err = Object.assign(new Error("401 — Invalid credentials"), { status: 401, method: "GET", endpoint: "/status" });
    expect(parseError(err)).toEqual({ message: "401 — Invalid credentials", status: 401, method: "GET", endpoint: "/status" });
  });
  test("stringifies anything else", () => {
    expect(parseError("plain")).toEqual({ message: "plain", status: null });
  });
});
