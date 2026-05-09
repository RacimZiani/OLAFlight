# Ola Flight — image prod avec Chromium (PDF + scraping Playwright).
# Version d'image à aligner avec "playwright" dans package.json (mineure 1.59).
# https://playwright.dev/docs/docker
FROM mcr.microsoft.com/playwright:v1.59.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
# Binaires navigateur fournis par l'image (ne pas lancer playwright install dans le conteneur).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 5179

# PORT peut être surchargé par la plateforme (Railway, Render, Fly).
CMD ["node", "src/index.js"]
