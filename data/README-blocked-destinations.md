# Destinations bloquées (`blocked-destinations.json`)

## Sources (mises à jour automatiques)

1. **US Department of State — Travel Advisories RSS**  
   https://travel.state.gov/_res/rss/TAsTWs.xml  
   Pays en **Level 3** (Reconsider Travel) et **Level 4** (Do Not Travel).

2. **ISO pays** (mapping noms → codes)  
   https://github.com/stefangabos/world_countries (CSV public)

3. **Extras Ola** — zones textuelles (Gaza, Kiev, Crimée…) dans `src/lib/fetchBlockedDestinations.mjs`

## Régénérer

```bash
npm run blocked:build
```

## En production

- Le fichier est versionné dans le repo (démarrage sans réseau).
- Au **démarrage du serveur**, si le fichier a plus de 7 jours, re-fetch du RSS US (variable `OLA_BLOCKED_REFRESH_DAYS`).

## Vérification

```bash
node scripts/test-route-policy.mjs
```
