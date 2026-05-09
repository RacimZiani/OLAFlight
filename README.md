# Ola Flight

Application **Node.js / Express** : site vitrine + back-office (CRM, Dalsim, admin vols), API métier, chatbot Claude, webhooks WhatsApp/Instagram, PDF devis, Calendly.

## Démarrer en local

À la racine du dépôt :

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Éditer .env : ANTHROPIC_API_KEY, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, …
npm run dev
```

→ [http://localhost:5179](http://localhost:5179) (port configurable via `PORT`).

Sur Windows, créer `.env` : `Copy-Item .env.example .env`

### Publier sur GitHub

```bash
git init
git add .
git status
git commit -m "Initial commit — Ola Flight"
git branch -M main
git remote add origin https://github.com/VOTRE_USER/VOTRE_REPO.git
git push -u origin main
```

Vérifier avant le premier commit qu’aucun fichier `.env` ni `data/*.db` n’apparaît dans `git status` (ils sont dans `.gitignore`).

### Scripts

| Commande | Rôle |
|----------|------|
| `npm run dev` | Serveur avec rechargement (`node --watch`) |
| `npm start` | Serveur production (sans watch) |
| `npm run db:print-init` | Affiche le SQL Supabase `001_init.sql` |
| `npm run db:print-rls` | Affiche le SQL RLS `002_rls.sql` |

### Structure

```
├── public/          # Frontend statique (index, login, crm, dalsim, admin…)
├── src/             # Serveur Express (routes, auth, DB, intégrations)
├── db/migrations/   # SQLite (*.sqlite.sql) + Postgres Supabase (*.sql)
├── data/            # SQLite local & JSON dev (gitignored sauf .gitkeep)
└── pdfs/            # PDF générés (gitignored)
```

---

## API

### Public

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET  /api/health`                     | Status + flags (anthropic, whatsapp, instagram, calendly) |
| `POST /api/chat`                       | Conversation client (landing chatbot)                |

### Métier (CRM / Dalsim)

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET  /api/leads`                      | Liste leads                                          |
| `POST /api/leads`                      | Crée un lead — déclenche notif Dalsim si `devis_pending` |
| `PATCH /api/leads/:id`                 | Update — déclenche notif Dalsim si transition vers `devis_pending` |
| `DELETE /api/leads/:id`                | Supprime un lead                                     |
| `GET  /api/devis`                      | Liste devis ; champs financiers filtrés par rôle    |
| `POST /api/devis`                      | Crée un devis — calcule marge/commissions, propage au lead |
| `POST /api/devis/:id/pdf`              | **Génère le PDF brandé**. Body `{send: true}` → envoie au client via WA/IG |

### Webhooks

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET  /api/webhooks/whatsapp`          | Verify Meta (`hub.challenge`)                        |
| `POST /api/webhooks/whatsapp`          | Reçoit un message → agent IA → réponse + persist conv |
| `GET  /api/webhooks/instagram`         | Idem Instagram                                       |
| `POST /api/webhooks/instagram`         | Idem Instagram                                       |
| `POST /api/webhooks/calendly`          | invitee.created → update lead `call_booked` + brief closeuse |

### Admin (JWT cookie, rôle `admin`)

| Méthode + URL                          | Description                       |
| -------------------------------------- | --------------------------------- |
| `GET  /api/admin/flights`              | Liste vols scrappés               |
| `POST /api/admin/flights/purge`        | `mode = demo \| noprice \| scraped \| all` |
| `POST /api/admin/flights/:id/status`   | `scraped \| shortlisted \| contacted \| booked` |
| `POST /api/admin/scrape`               | Booking → fallback Google Flights |

---

## Branchements externes (par étape)

### Génération PDF (T05) — déjà actif
Aucune conf nécessaire, marche dès `npm install`. Les PDFs sortent dans `pdfs/` et sont servis sur `/pdfs/<filename>`.

### WhatsApp Business (T02) — config Meta
1. Créer un Meta App (type "Business") sur https://developers.facebook.com
2. Ajouter le produit "WhatsApp" → noter le `Phone number ID`
3. Générer un **System User token** (jamais le User token court-terme)
4. `.env` :
   ```
   META_APP_SECRET=<App Secret>
   META_VERIFY_TOKEN=<chaîne arbitraire>
   WHATSAPP_TOKEN=<system user token>
   WHATSAPP_PHONE_NUMBER_ID=<phone id>
   ```
5. Webhook : `<PUBLIC_URL>/api/webhooks/whatsapp` + le `verify token` ci-dessus
6. S'abonner au champ `messages`

### Instagram DM (T07) — Meta App + page Instagram Business
1. Sur le même Meta App, ajouter "Instagram Graph API"
2. Lier la Page Facebook & le compte Instagram Business
3. `.env` : `INSTAGRAM_TOKEN`, `INSTAGRAM_PAGE_ID`
4. Webhook : `<PUBLIC_URL>/api/webhooks/instagram`, abonnement `messages`

### Notifications Dalsim (T04) — déjà actif
Renseigner `DALSIM_WHATSAPP=33612345678,33687654321` (E.164 sans `+`, CSV).
Sans WhatsApp configuré → fallback `data/outbox.json`.

### Calendly (T06)
- **Phase 1 (rapide)** : `CALENDLY_LINK=https://calendly.com/ola-flight/30min` → on envoie ce lien tel quel.
- **Phase 2 (tracking)** : `CALENDLY_TOKEN` + `CALENDLY_EVENT_TYPE_URI` → l'API crée des single-use links par lead.
- Webhook Calendly : `<PUBLIC_URL>/api/webhooks/calendly`, event `invitee.created`.

### Supabase (T01)
1. Créer projet Supabase, copier `URL` + `service_role_key`
2. Coller `db/migrations/001_init.sql` puis `002_rls.sql` dans le SQL editor
3. `.env` : `STORAGE_DRIVER=supabase`, `SUPABASE_URL=...`, `SUPABASE_SERVICE_ROLE_KEY=...`
4. Restart → `getStore()` bascule sur Supabase. L'API publique ne change pas.

---

## Sécurité — règles métier appliquées

| Règle | Description                                              | Où                                |
| ----- | -------------------------------------------------------- | --------------------------------- |
| S01   | `prix_revient` jamais dans PDF / IA / closeuse           | `commissions.js::sanitizeDevisForRole`, `pdf.js`, `pdfTemplate.js` (n'accepte pas le champ), RLS via `devis_public` view |
| S02   | Closeuse ne voit que ses leads                           | RLS `leads_closeuse_own` (002_rls.sql) |
| S03   | Deal `won` = montants verrouillés                        | Trigger `lock_won_devis` (001_init.sql) |
| S04   | Marge négative : alerte sans bloquer, commissions = 0    | `computeCommissions()`            |
| S05   | Code apporteur → lookup auto                             | TODO côté route `POST /api/leads` quand `apporteurs` peuplée |

---

## TODO suite

| Task | Description                                              | Statut |
| ---- | -------------------------------------------------------- | ------ |
| T01  | Auth Supabase + RLS                                      | 🟢 store implémenté + 002_rls.sql prêt — manque branchement JWT user |
| T02  | API WhatsApp Business (Meta Cloud API)                   | 🟢 webhook + adapter prêts — manque tokens prod |
| T03  | Anthropic branché agent ↔ webhook                        | ✅ done |
| T04  | Notifications Dalsim (push + WhatsApp)                   | 🟢 actif (fallback console si pas de token) |
| T05  | Générateur PDF devis (Playwright)                        | ✅ done |
| T06  | Calendly API + brief closeuse auto                       | 🟢 client + webhook prêts (lien statique fallback) |
| T07  | Webhook Instagram DM (Meta)                              | 🟢 prêt — manque tokens Meta |
