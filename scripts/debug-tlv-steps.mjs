import { extractRouteFromMessages } from "../src/lib/airports.js";

const msgs = [];
const add = (role, c) => {
  msgs.push({ role, content: c });
  if (role === "user") console.log(c, "→", extractRouteFromMessages([...msgs]));
};

add("assistant", "destination ?");
add("user", "tel aviv");
add("assistant", "depart ?");
add("user", "paris");
add("user", "demain pour 1 personne");
add("user", "business");
add("user", "perso");
add("user", "non");
add("user", "oui mais j'ai pas les trajets en tête là");
