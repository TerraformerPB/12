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
  form.append(nameInput, passInput, serverInput, loginBtn, registerBtn);

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
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'demolish';
  logoutBtn.textContent = 'Abmelden';
  profile.append(profileLine, matchBtn, uploadBtn, boardBtn, logoutBtn);

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

  events.on('online:openMenu', () => {
    overlay.hidden = false;
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
