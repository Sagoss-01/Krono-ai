# TechSphere Webmail v3.0

Plateforme webmail professionnelle — Node.js + EJS + Tailwind CSS (CLI) + DaisyUI + Socket.IO

---

## Structure

```
techsphere-webmail/
├── server.js
├── tailwind.config.js
├── package.json
├── .env.example
├── logs/                        ← logs automatiques par utilisateur
│   └── user@netiify.cloud/
│         ├── imap.log
│         ├── smtp.log
│         └── auth.log
├── src/
│   ├── routes.js
│   ├── controllers/
│   │   ├── authController.js    ← login, logout, multi-comptes
│   │   └── mailController.js    ← emails, dossiers, envoi
│   ├── services/
│   │   ├── imap.js              ← IMAP (bug race-condition corrigé)
│   │   ├── smtp.js              ← envoi SMTP
│   │   ├── socket.js            ← polling temps réel
│   │   └── logger.js            ← logs par utilisateur
│   └── middlewares/
│       └── auth.js
├── public/
│   ├── css/
│   │   ├── input.css            ← source Tailwind
│   │   ├── mail.css             ← styles de l'app mail
│   │   └── style.css            ← compilé par Tailwind (généré)
│   └── js/
│       ├── app.js               ← state global, thème, comptes, socket
│       ├── mail.js              ← liste, affichage, dossiers, cache
│       └── compose.js           ← composition, réponse, transfert
└── views/
    ├── pages/
    │   ├── home.ejs             ← page d'accueil
    │   ├── login.ejs            ← page de connexion (split layout)
    │   └── mail.ejs             ← interface webmail
    ├── components/
    │   ├── topbar.ejs
    │   ├── sidebar.ejs
    │   ├── compose.ejs
    │   └── modals.ejs
    └── layouts/
        └── base.ejs
```

---

## Installation

```bash
npm install
cp .env.example .env
# Modifier SESSION_SECRET dans .env

# Compiler Tailwind (obligatoire)
npm run tw:build

# Lancer
npm start
```

En développement :
```bash
# Terminal 1
npm run tw:watch

# Terminal 2
npm run dev
```

---

## Fonctionnalités

- ✅ Page d'accueil, page login, page webmail séparées
- ✅ Login split-panel — champ username + domaine fixe @netiify.cloud
- ✅ Multi-comptes simultanés avec switcher
- ✅ Cache localStorage — affichage instantané
- ✅ Bug IMAP liste vide — **corrigé** (resolve dans fetchReq.once('end'))
- ✅ Son à l'envoi d'email (Web Audio API)
- ✅ Notifications temps réel (Socket.IO + son)
- ✅ Logs détaillés par utilisateur dans logs/
- ✅ Thème clair/sombre persistant
- ✅ Interface responsive (mobile)
- ✅ Paramètres (thème, comptes, infos serveur)

---

## Nginx + SSL

```nginx
server {
    listen 80;
    server_name mail.netiify.cloud;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
```bash
certbot --nginx -d mail.netiify.cloud
```

## PM2

```bash
npm install -g pm2
pm2 start server.js --name techsphere-webmail
pm2 save && pm2 startup
```
