import {
  parseBoolish,
  parsePassagers,
  leadBoolForDb,
  coerceLeadRowForDb,
} from "../src/lib/dbCoerce.js";

const cases = [
  ["false", false],
  ["true", true],
  [false, false],
  [true, true],
  ["0", false],
  ["1", true],
  ["non", false],
];

for (const [input, expected] of cases) {
  const got = parseBoolish(input);
  if (got !== expected) {
    console.error(`parseBoolish(${JSON.stringify(input)}) = ${got}, expected ${expected}`);
    process.exit(1);
  }
}

if (leadBoolForDb("false") !== 0 || leadBoolForDb("true") !== 1) {
  console.error("leadBoolForDb failed");
  process.exit(1);
}

if (parsePassagers("false") !== 1 || parsePassagers(2) !== 2) {
  console.error("parsePassagers failed");
  process.exit(1);
}

const row = coerceLeadRowForDb({
  urgent: "false",
  needs_driver: false,
  needs_hotel: "true",
  passagers: "false",
});
if (row.urgent !== 0 || row.needs_driver !== 0 || row.needs_hotel !== 1 || row.passagers !== 1) {
  console.error("coerceLeadRowForDb", row);
  process.exit(1);
}

console.log("OK");
