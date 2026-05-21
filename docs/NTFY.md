# Notifications push — ntfy.sh

## Principe

- **Cloche CRM (site)** : notification en base, visible pour l’utilisateur connecté sur `crm.html` (filtrée par email / rôle).
- **Push ntfy** : même ciblage, mais envoyé sur le **téléphone** de chaque personne concernée.

Ce n’est **pas** un canal unique pour toute l’équipe : chaque compte a un **topic secret** dérivé de son email + `NTFY_TOPIC_SECRET`.

Exemples :

| Événement | Destinataires CRM | Push ntfy |
|-----------|-------------------|-----------|
| Nouveau lead assigné à Chloé | `chloe@…` | Chloé uniquement |
| Nouveau client chatbot → Lauren (apporteuse) | `lauren@…` | Lauren uniquement |
| Broadcast `{ role: "admin" }` | Tous les admins (cloche) | Chaque admin inscrit, sur son topic |

## Configuration serveur (Railway / `.env`)

1. Générer un secret (min. 16 caractères) :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Variables :

```env
NTFY_ENABLED=true
NTFY_TOPIC_SECRET=<collez le secret ici>
NTFY_SERVER=https://ntfy.sh
NTFY_TOPIC_PREFIX=olaflight
```

3. Redéployer l’app.

Optionnel : `NTFY_TOKEN` si vous utilisez un serveur ntfy privé avec authentification.

## Inscription par membre de l’équipe

1. Se connecter au CRM (`crm.html`).
2. Cliquer sur la **cloche** → **Push mobile**.
3. Installer l’app [ntfy](https://ntfy.sh) (iOS / Android) ou ouvrir le lien proposé.
4. S’abonner au topic personnel (lien copié automatiquement).
5. Accepter les notifications système.

Chaque personne refait cette étape **une fois** sur chaque appareil.

## Test

Après abonnement, déclencher un événement (ex. nouveau lead chatbot) ou :

```bash
curl -d "Test Ola Flight" -H "Title: Test" https://ntfy.sh/VOTRE_TOPIC
```

(Le topic exact est affiché dans **Push mobile**, ne pas le deviner.)

## Sécurité

- Le topic contient un fragment HMAC : sans `NTFY_TOPIC_SECRET`, il est difficile à deviner.
- Ne pas publier le lien d’abonnement (équivalent d’un mot de passe de notification).
- Pour plus de contrôle : héberger [ntfy](https://docs.ntfy.sh/) vous-même et utiliser `NTFY_SERVER` + `NTFY_TOKEN`.
