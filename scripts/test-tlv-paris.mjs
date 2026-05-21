import { extractRouteFromMessages } from "../src/lib/airports.js";
import { extractTravelDatesFromMessages } from "../src/lib/travelDates.js";
import { extractLeadHintsFromMessages } from "../src/lib/leadEnrichment.js";

const msgs = [
  { role: "assistant", content: "destination ?" },
  { role: "user", content: "tel aviv" },
  { role: "assistant", content: "depart ?" },
  { role: "user", content: "paris" },
  { role: "user", content: "demain pour 1 personne" },
  { role: "user", content: "business" },
  { role: "user", content: "perso" },
  { role: "user", content: "non" },
  { role: "assistant", content: "chauffeur privé pour les transferts ?" },
  { role: "user", content: "oui mais j'ai pas les trajets en tête là" },
];

const route = extractRouteFromMessages(msgs);
const hints = extractLeadHintsFromMessages(msgs);
console.log("route", route);
console.log("hints.needs_driver", hints.needs_driver);
if (route.to !== "TLV") {
  console.error("FAIL: expected TLV got", route.to);
  process.exit(1);
}
if (hints.needs_driver !== true) {
  console.error("FAIL: expected needs_driver true");
  process.exit(1);
}
console.log("OK");
