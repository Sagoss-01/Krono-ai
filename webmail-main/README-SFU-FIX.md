# Correctif mediasoup-client local

## Ce qui a été corrigé

- chargement prioritaire du bundle local **ESM** `public/vendor/mediasoup-client.bundle.mjs`
- fallback propre vers le bundle classique `public/vendor/mediasoup-client.bundle.js`
- résolution robuste des exports `default` et namespace
- versioning de cache côté navigateur avec `APP_BUILD_ID`
- génération de **deux** bundles via `npm run build:mediasoup-client`

## Déploiement

Dans le dossier du projet sur le serveur :

```bash
cd /var/www/webmail.netiify.cloud
npm install
npm run build:mediasoup-client
npm run tw:build
sudo systemctl restart webmail.service
```

## Vérifications

```bash
ls -l public/vendor/
curl -I http://127.0.0.1:3006/vendor/mediasoup-client.bundle.js
curl -I http://127.0.0.1:3006/vendor/mediasoup-client.bundle.mjs
```

Tu dois avoir les deux fichiers :
- `mediasoup-client.bundle.js`
- `mediasoup-client.bundle.mjs`

## Option recommandée

Ajoute dans ton fichier `.env` :

```env
APP_BUILD_ID=20260326-2
```

Puis redémarre le service. À chaque déploiement front important, change cette valeur pour casser le cache navigateur.
