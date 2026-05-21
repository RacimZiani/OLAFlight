import { extractRouteFromMessages } from "../src/lib/airports.js";

const msgs = [];
const add = (c) => {
  msgs.push({ role: "user", content: c });
  console.log(c, "→", extractRouteFromMessages([...msgs]));
};

add("bali");
add("tizi ouzou");
add("ok pour alger, et le plus tot possible");
add("cette semaine si possible ajd meme");
add("1 passager business");
add("perso pas d'hotel pas de chauffeurs");
