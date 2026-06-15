# Deployment auf einen eigenen Linux-VPS

Setup für **Frontend (Spiel) + Backend (Accounts/Bestenlisten/Duelle)** auf
einem Debian/Ubuntu-Server mit nginx-Reverse-Proxy und HTTPS (Let's Encrypt).

Ergebnis:
- Spiel unter `https://DEINE-DOMAIN`
- Admin-Dashboard unter `https://DEINE-DOMAIN/admin`
- Node-Backend lokal auf `127.0.0.1:8787`, von nginx unter `/api` und `/admin` geproxyt
- Das Spiel spricht das Backend automatisch same-origin an (keine manuelle Adress-Eingabe nötig)

## Voraussetzungen
- Frischer Debian/Ubuntu-VPS mit root/sudo
- Eine Domain, deren DNS-A-(und ggf. AAAA-)Record auf die Server-IP zeigt
- Ports 80 und 443 offen

## Einmaliges Setup

```bash
# 1) Repo nach /opt/burgspiel holen
sudo git clone -b claude/loving-thompson-my7ouf \
  <REPO-URL> /opt/burgspiel

# 2) Setup ausführen (baut, richtet systemd + nginx + HTTPS ein)
cd /opt/burgspiel
sudo DOMAIN=spiel.example.com EMAIL=du@example.com bash deploy/setup.sh
```

Das war's. Spiel: `https://spiel.example.com`, Admin: `.../admin`.

> Erster registrierter Account wird automatisch Admin. Alternativ vorab in
> `deploy/burgspiel.service` `BURGSPIEL_ADMIN_USER`/`_PASSWORD` setzen.

## Updates später

```bash
cd /opt/burgspiel
sudo bash deploy/deploy.sh
```

Zieht den neuen Stand, baut neu und lädt die Dienste neu.

## Nützliche Befehle

```bash
systemctl status burgspiel       # Backend-Status
journalctl -u burgspiel -f       # Backend-Logs
nginx -t && systemctl reload nginx
```

## Konfiguration (Env in `deploy/burgspiel.service`)

| Variable | Bedeutung | Default |
| --- | --- | --- |
| `PORT` | HTTP-Port des Backends | `8787` |
| `BURGSPIEL_DATA` | Pfad der JSON-Datendatei | `/opt/burgspiel/server-data/burgspiel.json` |
| `BURGSPIEL_CORS` | `Access-Control-Allow-Origin` | `*` |
| `BURGSPIEL_ADMIN_USER` / `_PASSWORD` | Admin-Seed beim ersten Start | — |
| `BURGSPIEL_RATE_MAX` | Requests pro 10 s und IP | `30` |

Daten liegen in `/opt/burgspiel/server-data/` — dieses Verzeichnis sichern.
