import { evaluateRoutePolicy } from "../src/lib/routePolicy.js";

const cases = [
  ["kiev", { to: "IEV" }],
  ["gaza", null],
  ["ukraine", null],
  ["russia", null],
  ["paris", { from: "CDG", to: "WAW" }],
];

for (const [msg, route] of cases) {
  const v = evaluateRoutePolicy(route, [{ role: "user", content: msg }], "fr");
  console.log(msg, "→", v.blocked ? "BLOCKED" : "ok", v.hit?.place || v.hit?.label || "");
}
