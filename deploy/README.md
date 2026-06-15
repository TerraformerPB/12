# Deployment auf einen eigenen Linux-VPS (hinter Cloudflare)

Setup für **Frontend (Spiel) + Backend (Accounts/Bestenlisten/Duelle)** auf
einem Debian/Ubuntu-Server mit nginx-Reverse-Proxy. Die Domain
`burg.paulbartsch.de` läuft über den **Cloudflare-Proxy** (orange Wolke),
Cloudflare übernimmt das öffentliche HTTPS.

Ergebnis:
- Spiel unter `https://burg.paulbartsch.de`
- Admin-Dashboard unter `https://burg.paulbartsch.de/admin`
- Node-Backend lokal auf `127.0.0.1:8787`, von nginx unter `/api` und `/admin` geproxyt
- Verschlüsselung Cloudflare→Origin via Origin-Cert (nginx 443)
- Das Spiel spricht das Backend automatisch same-origin an (keine manuelle Adresse nötig)

## Voraussetzungen
- Frischer Debian/Ubuntu-VPS mit root/sudo (IP `217.160.190.29`)
- Cloudflare-DNS: A-Record `burg` → `217.160.190.29`, Proxy **an** (orange) ✅ schon erledigt
- Ports 80 und 443 am Server offen

## Einmaliges Setup

Das Repo kann in **jedem** Verzeichnis liegen — setup.sh erkennt den Pfad
selbst (hier z. B. `/var/www/burg/burg`).

```bash
# 1) Repo holen (oder vorhandenes Verzeichnis nutzen)
sudo git clone -b claude/loving-thompson-my7ouf \
  <REPO-URL> /var/www/burg/burg

# 2) Setup ausführen (baut, richtet systemd + nginx + Origin-Cert ein)
cd /var/www/burg/burg
sudo bash deploy/setup.sh
```

## 3) Cloudflare SSL-Modus setzen (einmalig, im Cloudflare-Dashboard)

**SSL/TLS → Overview → Modus „Full"** auswählen.

- „Full" passt zum selbstsignierten Origin-Cert, das `setup.sh` erzeugt.
- Nicht „Flexible" (sonst Redirect-Loop, da nginx auf HTTPS umleitet).
- Optional besser „Full (strict)": dazu ein **Cloudflare Origin Certificate**
  erstellen, als `/etc/ssl/burgspiel/origin.crt` + `origin.key` ablegen
  (`systemctl reload nginx`) und CF-Modus auf „Full (strict)" stellen.

Danach: Spiel unter `https://burg.paulbartsch.de`, Admin unter `.../admin`.

> Erster registrierter Account wird automatisch Admin. Alternativ vorab in
> `deploy/burgspiel.service` `BURGSPIEL_ADMIN_USER`/`_PASSWORD` setzen.

## Updates später

```bash
cd /var/www/burg/burg
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
| `BURGSPIEL_DATA` | Pfad der JSON-Datendatei | `<APP_DIR>/server-data/burgspiel.json` |
| `BURGSPIEL_CORS` | `Access-Control-Allow-Origin` | `*` |
| `BURGSPIEL_TRUST_PROXY` | Client-IP aus `X-Forwarded-For` (hinter Proxy) | `1` |
| `BURGSPIEL_ADMIN_USER` / `_PASSWORD` | Admin-Seed beim ersten Start | — |
| `BURGSPIEL_RATE_MAX` | Requests pro 10 s und IP | `30` |

Daten liegen in `<APP_DIR>/server-data/` — dieses Verzeichnis sichern.
