import { extractRouteFromMessages, parseRouteFromText } from "../src/lib/airports.js";
import { extractTravelDatesFromMessages } from "../src/lib/travelDates.js";

const msgs = [
  { role: "assistant", content: "destination ?" },
  { role: "user", content: "bali" },
  { role: "assistant", content: "depart ?" },
  { role: "user", content: "tizi ouzou" },
  { role: "user", content: "ok pour alger, et le plus tot possible" },
  { role: "user", content: "cette semaine si possible ajd meme" },
  { role: "user", content: "1 passager business" },
  { role: "user", content: "perso pas d'hotel pas de chauffeurs" },
  {
    role: "user",
    content:
      "Identité client (formulaire web) :\n- Prénom : Racim\n- Nom : Ziani\n- Email : racimziani@outlook.com\n- Téléphone : +33766701092",
  },
];

console.log("route", extractRouteFromMessages(msgs));
console.log("dates", extractTravelDatesFromMessages(msgs));
console.log("pas parse", parseRouteFromText("perso pas d'hotel pas de chauffeurs"));

import { buildLeadUpsertPayload } from "../src/lib/leadEnrichment.js";
import { extractContactFromMessages } from "../src/lib/contactFormUi.js";

console.log("contact", extractContactFromMessages(msgs));
const { payload } = buildLeadUpsertPayload({
  args: { status: "devis_pending", notes: "Demande urgente ALG→DPS" },
  existing: null,
  context: { conversationMessages: msgs, channel: "web", contact: "web-test" },
});
console.log("payload", payload);
