# Ola Flight

Application **Node.js / Express** : site vitrine + back-office (CRM, admin vols), API métier, **agent IA** (Anthropic + outils : leads, devis, PDF, scraping), notifications internes, PDF devis (Playwright), webhooks optionnels (WhatsApp / Instagram / Calendly).

---

## Guide d’installation pour l’équipe (local, tests et démo)

Objectif : qu’un autre développeur ait **le même fonctionnement** que sur ta machine (site, chatbot, CRM, PDF, agent avec outils) en suivant ce guide de bout en bout.

### 1. Prérequis

| Outil | Version / note |
|--------|----------------|
| **Node.js** | **≥ 18.18** (voir `engines` dans `package.json`) |
| **npm** | Fourni avec Node |
| **Git** | Pour cloner le dépôt |
| **Réseau** | Accès Internet pour `npm install`, CDN (ex. GSAP sur la home), API Anthropic |
| **Optionnel** | Compte [Anthropic](https://console.anthropic.com) (clé API) ; compte [Supabase](https://supabase.com) si vous utilisez la base distante comme en prod |

Sur **Windows** : utilisez PowerShell ou le terminal intégré ; en cas d’échec de compilation de `better-sqlite3`, installez les [Build Tools Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (charge de travail « Développement Desktop en C++ »).

### 2. Cloner et installer les dépendances

```bash
git clone https://github.com/RacimZiani/OLAFlight.git
cd OLAFlight
npm install
```

### 3. Navigateurs Playwright (PDF + scraping)

La génération de **PDF** et le scraping (Google Flights / Booking) utilisent **Chromium** via Playwright :

```bash
npx playwright install chromium
```

Sans cette étape, les PDF et certains appels admin peuvent échouer avec une erreur du type « browser not found ».

### 4. Fichier d’environnement `.env`

À la racine du dépôt :

```bash
cp .env.example .env
```

Sur **Windows** :

```powershell
Copy-Item .env.example .env
```

Puis **éditer `.env`**. Rien de ce fichier ne doit être commité (déjà dans `.gitignore`).

#### Variables **indispensables** pour une démo « tout fonctionnel »

| Variable | Rôle |
|----------|------|
| **`ANTHROPIC_API_KEY`** | Chatbot / agent IA sur le site et outils (`upsert_lead`, `create_devis_from_offer`, scraping…). Sans clé, `/api/health` indique `anthropic: false` et le chat ne répond pas correctement. |
| **`JWT_SECRET`** | Secret de signature des cookies de session (CRM, admin). **En dev, sans cette variable**, le serveur en génère un au démarrage : **à chaque redémarrage les sessions sont invalidées** — il faut se reconnecter. Pour travailler à plusieurs sans surprise, définir une chaîne longue et fixe, ex. : `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| **`ADMIN_EMAIL`** / **`ADMIN_PASSWORD`** | Compte back-office. Si `ADMIN_PASSWORD` est vide au **premier** démarrage avec une base vide, un mot de passe aléatoire peut être affiché dans les **logs** du serveur. Mieux vaut fixer un mot de passe connu dans `.env` avant le premier lancement, ou recréer la base (SQLite : supprimer `data/ola-flight.db` après avoir sauvegardé si besoin). |
| **`PUBLIC_URL`** | URL publique de l’API pour les liens **absolus** (PDF, etc.). En local : `http://localhost:5179` (ou `http://localhost:<PORT>` si vous changez `PORT`). |

#### Variables **base de données** (choisir un mode)

**Mode recommandé pour un setup rapide (démo solo, zéro compte cloud)** :

```env
STORAGE_DRIVER=sqlite
```

- Le fichier SQLite est créé automatiquement (par défaut `data/ola-flight.db`).
- Les migrations **`*.sqlite.sql`** dans `db/migrations/` sont appliquées **au démarrage** (ordre alphabétique).
- Aucun script SQL manuel n’est nécessaire pour démarrer.

**Mode aligné sur la prod (équipe, données partagées)** :

```env
STORAGE_DRIVER=supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...
```

- Le projet utilise la **service role key** (serveur uniquement — ne jamais l’exposer au navigateur).
- Si Supabase est injoignable au démarrage, l’app peut **basculer sur SQLite** avec un avertissement dans les logs (voir `src/db/index.js`).

#### Autres variables (optionnelles)

- **`PORT`** : défaut `5179`.
- **`COOKIE_SECURE`** : `false` en local (HTTP) ; `true` en prod (HTTPS).
- **Meta / WhatsApp / Instagram / Calendly** : voir section plus bas ; **non requis** pour tester chatbot web + CRM + PDF en local.

### 5. Migrations Supabase (si `STORAGE_DRIVER=supabase`)

À exécuter dans l’**éditeur SQL** du projet Supabase, **dans l’ordre** (ne pas sauter les étapes déjà appliquées sur un projet existant ; en cas de doute, cohérence avec la prod) :

1. `db/migrations/001_init.sql`
2. `db/migrations/002_rls.sql`
3. `db/migrations/003_agent_actions.sql`
4. `db/migrations/004_conversations_ola_fields.sql`
5. `db/migrations/005_users_auth_fields.sql`
6. `db/migrations/006_notifications.sql`
7. `db/migrations/007_devis_options.sql`
8. `db/migrations/008_extras_hotel_driver.sql`

Sans **`006`–`008`**, certaines fonctionnalités **dégradent** (notifications persistées, options multiples sur les devis, champs extras hôtel/chauffeur côté lead/devis) — le code prévoit souvent des **fallbacks**, mais le comportement complet attend ces colonnes/tables.

### 6. Lancer le serveur

```bash
npm run dev
```

Logs attendus (extrait) : stockage (`sqlite` ou `supabase`), URL d’écoute, éventuels avertissements (`JWT_SECRET` manquant, etc.).

- **Site vitrine + chatbot** : [http://localhost:5179](http://localhost:5179) (ou votre `PORT`)
- **Connexion CRM / admin** : [http://localhost:5179/login.html](http://localhost:5179/login.html)
- **CRM** : [http://localhost:5179/crm.html](http://localhost:5179/crm.html)
- **Admin (scraping manuel, etc.)** : [http://localhost:5179/admin.html](http://localhost:5179/admin.html)
- **Santé API** : [http://localhost:5179/api/health](http://localhost:5179/api/health) — doit afficher `anthropic: true` si la clé est renseignée

Le compte admin est **créé au premier démarrage** si la table `users` est vide (`src/seeds/admin.js`), à partir de `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`.

### 7. Vérifications rapides « tout est OK »

1. **`GET /api/health`** → `status: "ok"`, `anthropic: true` (si clé définie).
2. Ouvrir la **home** : hero, animation (GSAP chargé depuis le CDN), bouton qui ouvre le **chatbot**.
3. Envoyer un message dans le chat : réponse de l’agent (qualification, puis devis si le flux est mené jusqu’au bout).
4. Se connecter au **CRM** avec l’admin : pipeline, fiche lead, éventuellement édition de devis / résumé conversation selon les migrations.
5. **PDF** : après création d’un devis (par l’agent ou le CRM), vérifier qu’un fichier apparaît sous `pdfs/` et est accessible via `/pdfs/...`.

### 8. Dépannage courant

| Symptôme | Piste |
|---------|--------|
| `better-sqlite3` ne compile pas | Node à jour ; sur Windows, Visual Studio Build Tools ; sinon `npm rebuild better-sqlite3`. |
| Playwright « browser not found » | Relancer `npx playwright install chromium`. |
| Session CRM perdue à chaque `npm run dev` | Définir **`JWT_SECRET`** dans `.env`. |
| Erreurs Supabase « column does not exist » | Appliquer les migrations **006–008** (et précédentes) listées ci-dessus. |
| Chatbot sans réponse / erreur clé | Vérifier **`ANTHROPIC_API_KEY`** et les logs serveur. |
| **`POST /api/auth/users` / création de user** échoue avec une erreur UUID | En Supabase, l’`id` utilisateur doit être un UUID — corriger côté app ou créer l’utilisateur depuis le dashboard Supabase si besoin. |

### 9. Commandes utiles

| Commande | Rôle |
|----------|------|
| `npm run dev` | Serveur avec rechargement (`node --watch`) |
| `npm start` | Serveur production (sans watch) |
| `npm run db:print-init` | Affiche le SQL Postgres `001_init.sql` dans le terminal |
| `npm run db:print-rls` | Affiche le SQL RLS `002_rls.sql` |

### 10. Déployer vite (**recommandé : Railway ou Render + Docker**)

Pour une **démo complète** (chat, CRM, **PDF**, **scraping**) en **~10 minutes**, sans VPS à configurer : déploie le **`Dockerfile`** du repo. Il repose sur l’[image officielle Playwright](https://playwright.dev/docs/docker) (Chromium déjà présent).

#### Prérequis (une fois)

1. Projet **Supabase** avec les migrations **001 → 008** exécutées (voir §5).  
2. Variables prêtes : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, etc.

#### Option A — [Railway](https://railway.app) *(le plus fluide en pratique)*

1. **New project** → **Deploy from GitHub** → sélectionne ce repo.  
2. Railway détecte le **Dockerfile** et build tout seul.  
3. Onglet **Variables** : ajoute toutes les variables (même schéma que `.env`), en particulier :
   - `STORAGE_DRIVER=supabase`
   - `NODE_ENV=production`
   - `COOKIE_SECURE=true`
   - `LOG_PRETTY=false` (logs JSON plus lisibles sur la plateforme)
4. **Networking** → génère un domaine public (ex. `*.up.railway.app`).  
5. Remets cette URL dans **`PUBLIC_URL`** (ex. `https://ton-service.up.railway.app`, sans slash final) → redéploie si besoin.  
6. Ouvre l’URL → `/api/health` doit être `ok`, puis teste la home et le chat.

*Note :* Railway injecte **`PORT`** automatiquement ; l’app l’utilise déjà.

#### Option B — [Render](https://render.com)

1. **New** → **Web Service** → connecte le repo.  
2. **Runtime** : **Docker** (laisse Dockerfile par défaut).  
3. **Instance** : gratuit possible (cold start ~1 min ; pour une démo live, un plan payant évite la mise en veille).  
4. Ajoute les **Environment** comme sur Railway + `PUBLIC_URL` une fois l’URL Render connue (`https://xxx.onrender.com`).  

#### Option C — [Fly.io](https://fly.io)

```bash
fly launch --copy-config --dockerfile Dockerfile
fly secrets set STORAGE_DRIVER=supabase SUPABASE_URL=... # etc.
fly deploy
```

(Depuis un machine avec l’CLI Fly — un peu plus long que Railway cliquer-coller.)

#### Pourquoi Docker ici plutôt que « Node nu » sur la plateforme ?

Sans image Playwright, il faudrait un script du type `npx playwright install --with-deps chromium` au build, sensible aux distro et aux paquets système. L’image **`mcr.microsoft.com/playwright`** évite ça : **un build, même comportement** que ta machine pour PDF + scraper.

#### Rappel : Vercel (léger, sans PDF fiable)

Le fichier `vercel.json` + `api/index.js` permet une **landing + API + chat + CRM** sur [Vercel](https://vercel.com), mais **PDF / scraping Playwright** y sont en général **non fiables** (serverless). Les détails sont dans la section suivante si tu veux quand même cette option.

### 11. Déployer sur Vercel (démo rapide, sans PDF garanti)

#### Obligatoire pour que ça tienne la route

| Exigence | Pourquoi |
|----------|----------|
| **`STORAGE_DRIVER=supabase`** | Sur Vercel les fonctions sont **serverless** : pas de fichier `data/ola-flight.db` persistant entre les invocations. La base doit être **Supabase** (ou un Postgres distant équivalent — non documenté ici). |
| Migrations **001 → 008** | Comme en local prod : exécuter tous les scripts SQL listés en §5 dans le projet Supabase. |
| Variables d’env sur Vercel | Reprendre le même schéma que `.env` : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, etc. |
| **`PUBLIC_URL`** | Mettre l’URL exacte du déploiement, ex. `https://ola-flight.vercel.app` (sans slash final), pour les liens PDF / absolus. |
| **`COOKIE_SECURE=true`** | En HTTPS sur Vercel, les cookies de session doivent être marqués secure. |

#### Limitations importantes (à connaître avant une démo client)

| Fonctionnalité | Sur Vercel |
|----------------|------------|
| **Site, API, chatbot Anthropic, CRM, auth** | En principe **OK** avec Supabase + bonnes variables d’env. |
| **Génération PDF (Playwright / Chromium)** | **Très souvent indisponible** ou **fragile** sur les fonctions serverless (taille binaire, cold start, sandbox). Les PDF sont écrits dans `/tmp` côté code, mais le lancement de Chromium échoue fréquemment. **Pour une démo avec PDF fiable**, préférer un **VPS / Railway / Render / Fly.io** (process Node long-running) ou ta machine locale. |
| **Scraping admin (Playwright)** | Même problème que les PDF. |
| **Timeout** | Sur le plan gratuit Vercel, le temps d’exécution d’une fonction est **limité** (~10 s). Un premier appel (cold start + init DB + appel LLM) peut dépasser → envisager le plan Pro ou une plateforme long-running pour des démos lourdes. |

**Résumé** : Vercel = excellent pour montrer **la landing + le chat IA + le CRM** connecté à Supabase ; pour **PDF + scraper** comme en local, utiliser un hébergeur **Node classique** (toujours `npm start` + `PUBLIC_URL`).

### 12. Structure du dépôt

```
├── public/          # Frontend statique (index, login, crm, admin…)
├── src/             # Serveur Express (routes, auth, DB, agent IA, PDF)
├── db/migrations/   # SQLite (*.sqlite.sql) + Postgres Supabase (*.sql)
├── data/            # SQLite local (gitignored, sauf .gitkeep)
├── pdfs/            # PDF générés (gitignored)
├── api/             # Point d'entrée Vercel (serverless-http)
├── Dockerfile       # Prod Playwright (Railway / Render / Fly)
└── scripts/         # Scripts utilitaires (ex. probe scraper)
```

### 13. Publier sur GitHub (rappel)

Avant un commit, vérifier que **`git status`** ne liste pas `.env`, `data/*.db`, `pdfs/*`, ni de secrets.

---

## API (aperçu)

### Public

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET  /api/health`                     | Status + flags (anthropic, whatsapp, instagram, calendly) |
| `POST /api/chat`                       | Conversation client (landing chatbot + agent outillé) |

### Métier (CRM — cookie JWT)

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET  /api/leads`                      | Liste leads (filtrée par rôle closer / admin)       |
| `POST /api/leads`                      | Crée un lead                                         |
| `PATCH /api/leads/:id`                 | Mise à jour (statut, closer, …)                     |
| `GET  /api/leads/:id/summary`          | Résumé IA de la conversation                         |
| `GET  /api/leads/:id/conversation`     | Transcript messages (persistés)                       |
| `GET  /api/leads/:id/devis`            | Devis liés au lead                                   |
| `GET  /api/devis`                      | Liste devis                                         |
| `GET  /api/devis/:id`                  | Détail d’un devis                                   |
| `PATCH /api/devis/:id`                 | Édition + régénération PDF (selon body)              |
| `POST /api/devis`                      | Crée un devis (rôles admin/dalsim)                   |
| `POST /api/devis/:id/pdf`              | Génère / envoie le PDF                               |
| `GET  /api/notifications`              | Notifications back-office                            |

### Webhooks (optionnels)

| Méthode + URL                          | Description                                          |
| -------------------------------------- | ---------------------------------------------------- |
| `GET/POST /api/webhooks/whatsapp`       | Meta WhatsApp Cloud API                              |
| `GET/POST /api/webhooks/instagram`      | Instagram DM                                         |
| `POST /api/webhooks/calendly`          | Calendly `invitee.created`                           |

### Admin

| Méthode + URL                          | Description                       |
| -------------------------------------- | --------------------------------- |
| `GET  /api/admin/flights`              | Liste vols scrappés               |
| `POST /api/admin/scrape`               | Lancement scraping (Booking / GF fallback) |

---

## Branchements externes (par étape)

### Génération PDF
Aucune clé externe obligatoire : Playwright + dossier `pdfs/` + `PUBLIC_URL` pour les liens absolus.

### WhatsApp Business (Meta)
1. App Meta type Business → produit WhatsApp → `Phone number ID`
2. **System User** token (longue durée)
3. `.env` : `META_APP_SECRET`, `META_VERIFY_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
4. Webhook : `<PUBLIC_URL>/api/webhooks/whatsapp`

### Instagram DM
Même App Meta, Instagram Graph API, webhooks `messages`.

### Notifications équipe (legacy env)
`DALSIM_WHATSAPP` : numéros E.164 sans `+`, séparés par des virgules.

### Calendly
- Phase 1 : `CALENDLY_LINK` (lien statique)
- Phase 2 : `CALENDLY_TOKEN`, `CALENDLY_EVENT_TYPE_URI`, webhook signé

### Supabase
Voir section **migrations** ci-dessus : `001` → `008` pour un schéma complet à jour.

---

## Sécurité — règles métier (rappel)

| Règle | Description                                              |
| ----- | -------------------------------------------------------- |
| S01   | Champs financiers sensibles masqués pour certains rôles  |
| S02   | Closer : leads / devis limités à son périmètre           |
| S03   | Deal `won` : verrous possibles côté schéma               |
| S04   | Marge négative : commissions à zéro                      |

---

## TODO / suites possibles

Évolutions listées historiquement dans le dépôt : auth utilisateurs avancée, tokens Meta prod, Calendly API complète, etc. Adapter cette section au backlog réel de l’équipe.
