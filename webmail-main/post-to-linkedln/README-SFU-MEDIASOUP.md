# Migration SFU mediasoup — TechSphere Webmail

## 1) Dépendances
```bash
cd /var/www/webmail.netiify.cloud
npm install
npm run tw:build
```

## 2) Variables d'environnement à ajouter
```env
MEDIASOUP_ANNOUNCED_ADDRESS=webmail.netiify.cloud
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_WORKERS=2
MEDIASOUP_LOG_LEVEL=warn
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=50999
MEDIASOUP_UDP_MIN_PORT=40000
MEDIASOUP_UDP_MAX_PORT=49999
MEDIASOUP_TCP_MIN_PORT=50000
MEDIASOUP_TCP_MAX_PORT=50999
```

Si ton serveur a plus de CPU, tu peux augmenter `MEDIASOUP_WORKERS`.

## 3) Firewall / UFW
Ouvre la plage RTP utilisée par mediasoup :
```bash
sudo ufw allow 40000:49999/udp
sudo ufw allow 50000:50999/tcp
sudo ufw reload
```

## 4) Nginx
La partie HTTP/WebSocket actuelle peut rester telle quelle. mediasoup ne passe pas dans Nginx pour les flux RTP/ICE, donc la plage de ports ci-dessus doit être ouverte directement sur le VPS.

## 5) Redéploiement systemd
```bash
sudo systemctl daemon-reload
sudo systemctl restart webmail.service
sudo journalctl -u webmail.service -f
```

## 6) Vérifications rapides
- Ouvre une réunion avec 3 navigateurs.
- Vérifie qu'un participant peut rejoindre après qu'un partage d'écran a déjà commencé.
- Vérifie que l'audio fonctionne même si plusieurs caméras sont actives.
- Dans Chrome, ouvre `chrome://webrtc-internals` pour confirmer que les flux passent bien par les transports SFU.

## 7) Important
- La config TURN/STUN existante reste utilisée côté client pour ICE.
- Le média n'est plus envoyé en mesh P2P entre tous les pairs : il passe par mediasoup côté serveur.
- Si tu utilises un firewall cloud (Hostinger / provider), ouvre aussi la même plage de ports là-bas.
