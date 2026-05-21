import { buildClientQuoteMessage, optionsForToolOutput } from "../src/lib/devisQuoteMessage.js";

const priced = [
  { label: "Express", compagnie: "Air France + Garuda", stops: 1, prix_vente: 2890 },
  { label: "Confort", compagnie: "KLM + Singapore", stops: 1, prix_vente: 3250 },
  { label: "Premium", compagnie: "Emirates + Qatar", stops: 1, prix_vente: 3680 },
];

const msg = buildClientQuoteMessage({
  options: priced,
  routeLabel: "Paris → Bali",
  publicPdfUrl: "https://olaflight.fr/api/public/devis/OLA-test/pdf",
  lang: "fr",
});

console.log(msg);
console.log("\n--- options_display ---");
console.log(JSON.stringify(optionsForToolOutput(priced), null, 2));

const display = optionsForToolOutput(priced).map((o) => o.prix_vente_display);
for (const d of display) {
  if (!msg.includes(d)) {
    console.error(`FAIL: affichage ${d} absent du message`);
    process.exit(1);
  }
}
console.log("\nOK");
