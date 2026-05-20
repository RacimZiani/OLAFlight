import { extractRouteFromMessages, parseRouteFromText } from "../src/lib/airports.js";

const msgs = [
  { role: "assistant", content: "Hello, welcome. what's your destination?" },
  { role: "user", content: "je veux aller à kiev" },
  { role: "assistant", content: "Varsovie ?" },
  { role: "user", content: "ok pour varsovie" },
  { role: "assistant", content: "D'où souhaitez-vous partir pour Varsovie ?" },
  { role: "user", content: "paris" },
  { role: "user", content: "Identité client (formulaire web) :\n- Prénom : Racim" },
];

console.log("conversation route:", extractRouteFromMessages(msgs));
console.log("form only:", parseRouteFromText(msgs[6].content));
