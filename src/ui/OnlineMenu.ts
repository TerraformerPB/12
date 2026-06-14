import { events } from '../core/EventBus';
import { OnlineClient, OnlineError } from '../online/OnlineClient';
import type { Game } from '../core/Game';

/**
 * Online dialog (🌐 in the main menu): account login/registration, the
 * server-side profile, online leaderboards and online duel matchmaking.
 * Also wires the background sync: best runs and online duel results are
 * reported automatically while logged in.
 */
export function createOnlineMenu(uiRoot: HTMLElement, game: Game): OnlineClient {
  const client = new OnlineClient();

  const overlay = document.createElement('div');
  overlay.className = 'pause-overlay menu-dialog';
  overlay.hidden = true;
  const card = document.createElement('div');
  card.className = 'pause-card duel-card';
  const heading = document.createElement('h2');
  heading.textContent = '🌐 Online';
  const msg = document.createElement('p');
  msg.className = 'gameover-stats online-msg';

  // --- logged-out form ---
  const form = document.createElement('div');
  form.className = 'online-form';
  const nameInput = document.createElement('input');
  nameInput.placeholder = 'Name (3–20 Zeichen)';
  nameInput.maxLength = 20;
  nameInput.autocomplete = 'username';
  const passInput = document.createElement('input');
  passInput.type = 'password';
  passInput.placeholder = 'Passwort (min. 6 Zeichen)';
  passInput.autocomplete = 'current-password';
  const serverInput = document.createElement('input');
  serverInput.placeholder = 'Server-Adresse';
  serverInput.value = client.serverUrl;
  const loginBtn = document.createElement('button');
  loginBtn.textContent = 'Anmelden';
  const registerBtn = document.createElement('button');
  registerBtn.textContent = 'Konto erstellen';
  const guestBtn = document.createElement('button');
  guestBtn.textContent = '👤 Als Gast spielen';
  guestBtn.className = 'menu-btn-secondary';
  form.append(nameInput, passInput, serverInput, loginBtn, registerBtn, guestBtn);

  // --- logged-in profile ---
  const profile = document.createElement('div');
  profile.hidden = true;
  const profileLine = document.createElement('p');
  profileLine.className = 'gameover-stats';
  const matchBtn = document.createElement('button');
  matchBtn.textContent = '🌍 Online-Duell suchen';
  const uploadBtn = document.createElement('button');
  uploadBtn.textContent = '🏰 Burg hochladen';
  const boardBtn = document.createElement('button');
  boardBtn.textContent = '🏆 Online-Bestenliste';
  const adminBtn = document.createElement('button');
  adminBtn.textContent = '⚙️ Admin-Bereich';
  adminBtn.style.borderColor = 'var(--ui-accent)';
  adminBtn.hidden = true;
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'demolish';
  logoutBtn.textContent = 'Abmelden';
  profile.append(profileLine, matchBtn, uploadBtn, boardBtn, adminBtn, logoutBtn);

  // --- leaderboard view ---
  const board = document.createElement('div');
  board.className = 'menu-scores';
  board.hidden = true;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Schließen';
  closeBtn.addEventListener('click', () => (overlay.hidden = true));

  card.append(heading, msg, form, profile, board, closeBtn);
  overlay.appendChild(card);
  uiRoot.appendChild(overlay);

  // --- admin dialog ---
  const adminDlg = document.createElement('div');
  adminDlg.className = 'pause-overlay menu-dialog';
  adminDlg.hidden = true;
  const adminCard = document.createElement('div');
  adminCard.className = 'pause-card duel-card admin-card';
  const adminHeading = document.createElement('h2');
  adminHeading.textContent = '⚙️ Admin-Bereich';
  const adminStatsLine = document.createElement('p');
  adminStatsLine.className = 'gameover-stats';
  const adminAdsToggleBtn = document.createElement('button');
  adminAdsToggleBtn.className = 'menu-btn-secondary';
  adminAdsToggleBtn.style.margin = '10px 0';
  adminAdsToggleBtn.textContent = 'Werbung laden...';
  const adminBody = document.createElement('div');
  adminBody.className = 'menu-scores admin-users-list';
  const adminClose = document.createElement('button');
  adminClose.textContent = 'Zurück';
  adminClose.addEventListener('click', () => (adminDlg.hidden = true));
  adminCard.append(adminHeading, adminStatsLine, adminAdsToggleBtn, adminBody, adminClose);
  adminDlg.appendChild(adminCard);
  uiRoot.appendChild(adminDlg);

  adminAdsToggleBtn.addEventListener('click', () => {
    void guard(async () => {
      const enabled = await client.adminToggleAds();
      const newStats = await client.adminFetchStats();
      adminStatsLine.innerHTML = `Nutzer: ${newStats.users} (banned: ${newStats.banned}) · Duelle gesamt: ${newStats.duelsTotal} (heute: ${newStats.duelsToday}) · Burgen: ${newStats.castles} · 📺 Werbung gesamt: ${newStats.adsTotal}`;
      adminAdsToggleBtn.textContent = enabled ? '📺 Werbung: Aktiviert (Klicken zum Deaktivieren)' : '📺 Werbung: Deaktiviert (Klicken zum Aktivieren)';
      adminAdsToggleBtn.className = enabled ? 'menu-btn-secondary' : 'menu-btn-secondary demolish';
    });
  });

  const setMsg = (text: string, error = false): void => {
    msg.textContent = text;
    msg.classList.toggle('online-error', error);
  };

  const refresh = (): void => {
    const user = client.user;
    form.hidden = user !== null;
    profile.hidden = user === null;
    board.hidden = true;
    if (user) {
      profileLine.textContent =
        `👤 ${user.username} · 🏆 ${user.trophies} · ` +
        `${user.duelWins}S/${user.duelLosses}N · Beste Wellen: ${user.bestWaves}`;
      uploadBtn.textContent = user.hasCastle ? '🏰 Burg aktualisieren' : '🏰 Burg hochladen';
      adminBtn.hidden = user.role !== 'admin';
    }
  };

  const guard = async (work: () => Promise<void>): Promise<void> => {
    try {
      setMsg('…');
      await work();
      // Clear the spinner unless the action set its own success message.
      if (msg.textContent === '…') setMsg('');
    } catch (err) {
      setMsg(err instanceof OnlineError ? err.message : 'Unbekannter Fehler', true);
    }
  };

  loginBtn.addEventListener('click', () =>
    guard(async () => {
      client.setServerUrl(serverInput.value || client.serverUrl);
      await client.login(nameInput.value.trim(), passInput.value);
      refresh();
    }),
  );
  registerBtn.addEventListener('click', () =>
    guard(async () => {
      client.setServerUrl(serverInput.value || client.serverUrl);
      await client.register(nameInput.value.trim(), passInput.value);
      setMsg('Konto erstellt — willkommen!');
      refresh();
    }),
  );
  guestBtn.addEventListener('click', () =>
    guard(async () => {
      client.setServerUrl(serverInput.value || client.serverUrl);
      await client.loginAsGuest();
      setMsg('Als Gast angemeldet!');
      refresh();
    }),
  );
  logoutBtn.addEventListener('click', () => {
    client.logout();
    refresh();
  });
  uploadBtn.addEventListener('click', () =>
    guard(async () => {
      await client.uploadCastle(game.exportCastleCode());
      setMsg('Burg liegt auf dem Server — andere können dich herausfordern.');
      refresh();
    }),
  );
  matchBtn.addEventListener('click', () =>
    guard(async () => {
      const opponent = await client.findMatch();
      overlay.hidden = true;
      game.startOnlineDuel(opponent);
    }),
  );
  boardBtn.addEventListener('click', () =>
    guard(async () => {
      const [trophies, waves] = await Promise.all([
        client.leaderboard('trophies'),
        client.leaderboard('waves'),
      ]);
      board.replaceChildren();
      const section = (text: string): void => {
        const el = document.createElement('div');
        el.className = 'menu-scores-section';
        el.textContent = text;
        board.appendChild(el);
      };
      const row = (text: string): void => {
        const el = document.createElement('div');
        el.className = 'menu-scores-row';
        el.textContent = text;
        board.appendChild(el);
      };
      section('🏆 Duell-Rangliste');
      if (trophies.length === 0) row('Noch keine Duelle gespielt.');
      for (const e of trophies.slice(0, 10)) {
        row(`${e.rank}. ${e.username} — ${e.trophies} (${e.wins}S/${e.losses}N)`);
      }
      section('🌊 Überlebte Wellen');
      if (waves.length === 0) row('Noch keine Läufe gemeldet.');
      for (const e of waves.slice(0, 10)) row(`${e.rank}. ${e.username} — ${e.waves} Wellen · ${e.kills} Gegner`);
      board.hidden = false;
    }),
  );

  adminBtn.addEventListener('click', () => {
    void guard(async () => {
      const statsData = await client.adminFetchStats();
      adminStatsLine.innerHTML = `Nutzer: ${statsData.users} (banned: ${statsData.banned}) · Duelle gesamt: ${statsData.duelsTotal} (heute: ${statsData.duelsToday}) · Burgen: ${statsData.castles} · 📺 Werbung gesamt: ${statsData.adsTotal}`;
      
      adminAdsToggleBtn.textContent = statsData.adsEnabled ? '📺 Werbung: Aktiviert (Klicken zum Deaktivieren)' : '📺 Werbung: Deaktiviert (Klicken zum Aktivieren)';
      adminAdsToggleBtn.className = statsData.adsEnabled ? 'menu-btn-secondary' : 'menu-btn-secondary demolish';

      const renderUsersList = async () => {
        adminBody.replaceChildren();
        const users = await client.adminFetchUsers();
        
        for (const u of users) {
          const row = document.createElement('div');
          row.className = 'admin-user-row';
          
          const label = document.createElement('span');
          label.className = 'admin-user-info';
          const roleBadge = u.role === 'admin' ? '🛡️' : '👤';
          const banStatus = u.banned ? ' 🚫 (gesperrt)' : '';
          label.innerHTML = `<strong>${u.username}</strong> ${roleBadge} · 🏆 ${u.trophies}${banStatus} · 📺 ${u.adsWatched ?? 0}`;
          
          const actions = document.createElement('div');
          actions.className = 'admin-user-actions';
          
          if (u.id !== client.user?.id) {
            const roleBtn = document.createElement('button');
            roleBtn.textContent = u.role === 'admin' ? 'Zu Spieler' : 'Zu Admin';
            roleBtn.className = 'mini-btn';
            roleBtn.addEventListener('click', async () => {
              await client.adminUserAction(u.id, u.role === 'admin' ? 'demote' : 'promote');
              await renderUsersList();
            });
            
            const banBtn = document.createElement('button');
            banBtn.textContent = u.banned ? 'Entsperren' : 'Sperren';
            banBtn.className = u.banned ? 'mini-btn' : 'mini-btn danger';
            banBtn.addEventListener('click', async () => {
              await client.adminUserAction(u.id, u.banned ? 'unban' : 'ban');
              const newStats = await client.adminFetchStats();
              adminStatsLine.innerHTML = `Nutzer: ${newStats.users} (banned: ${newStats.banned}) · Duelle gesamt: ${newStats.duelsTotal} (heute: ${newStats.duelsToday}) · Burgen: ${newStats.castles} · 📺 Werbung gesamt: ${newStats.adsTotal}`;
              await renderUsersList();
            });
            
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Löschen';
            delBtn.className = 'mini-btn danger';
            delBtn.addEventListener('click', async () => {
              if (confirm(`Möchtest du das Konto von ${u.username} wirklich löschen?`)) {
                await client.adminDeleteUser(u.id);
                const newStats = await client.adminFetchStats();
                adminStatsLine.innerHTML = `Nutzer: ${newStats.users} (banned: ${newStats.banned}) · Duelle gesamt: ${newStats.duelsTotal} (heute: ${newStats.duelsToday}) · Burgen: ${newStats.castles} · 📺 Werbung gesamt: ${newStats.adsTotal}`;
                await renderUsersList();
              }
            });
            
            actions.append(roleBtn, banBtn, delBtn);
          }
          
          row.append(label, actions);
          adminBody.appendChild(row);
        }
      };
      
      await renderUsersList();
      adminDlg.hidden = false;
    });
  });

  events.on('online:openMenu', () => {
    overlay.hidden = false;
    adminDlg.hidden = true;
    setMsg('');
    refresh();
    if (client.loggedIn && !client.user) {
      void guard(async () => {
        await client.fetchProfile();
        refresh();
      });
    }
  });

  // --- background sync (only while logged in) ---
  events.on('game:over', ({ wavesSurvived, kills }) => {
    void client.submitScore(wavesSurvived, kills);
  });
  events.on('game:victory', ({ kills }) => {
    void client.submitScore(game.waveSystem.waveNumber, kills);
  });
  events.on('duel:onlineResult', ({ opponentId, username, victory }) => {
    void (async () => {
      try {
        const delta = await client.reportDuel(opponentId, victory);
        const sign = delta >= 0 ? '+' : '';
        events.emit('toast:show', {
          message: `🌍 Online gegen ${username}: ${sign}${delta} 🏆 (jetzt ${client.user?.trophies})`,
        });
      } catch {
        events.emit('toast:show', { message: '🌍 Online-Ergebnis konnte nicht gemeldet werden' });
      }
    })();
  });

  return client;
}
