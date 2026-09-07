import { routeForKind, routeForNotification } from "../src/notificationRoutes";

const response = (data) => ({ notification: { request: { content: { data } } } });

describe("routeForKind", () => {
  test("an intruder alert opens the photo on Monitor", () => {
    expect(routeForKind("intruder")).toEqual({ tab: "Home", screen: "Monitor" });
  });

  test("an audit notification opens the log", () => {
    expect(routeForKind("audit")).toEqual({ tab: "Home", screen: "Log" });
  });

  test("a plain tab kind needs no nested screen", () => {
    expect(routeForKind("terminal")).toEqual({ tab: "Terminal" });
  });

  test("matching ignores case", () => {
    expect(routeForKind("INTRUDER")).toEqual({ tab: "Home", screen: "Monitor" });
  });

  test.each(["", "nonsense", null, undefined, 42, {}])(
    "%p has no destination, so the app just opens",
    (bad) => {
      expect(routeForKind(bad)).toBeNull();
    },
  );
});

describe("routeForNotification", () => {
  test("reads the kind out of the Expo payload", () => {
    expect(routeForNotification(response({ kind: "intruder" })))
      .toEqual({ tab: "Home", screen: "Monitor" });
  });

  test.each([
    ["no response at all", null],
    ["an empty response", {}],
    ["a notification with no data", { notification: { request: { content: {} } } }],
    ["data without a kind", response({})],
    ["a null data payload", response(null)],
  ])("%s yields no destination", (_label, input) => {
    expect(routeForNotification(input)).toBeNull();
  });
});
