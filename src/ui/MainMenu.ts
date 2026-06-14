import { events } from '../core/EventBus';
import { loadScores } from '../core/Highscores';
import { loadDuelRating } from '../core/DuelRating';
import { APP_VERSION } from '../data/config';
import { SCENARIO_IDS, getScenario } from '../data/scenarios';
import type { Game } from '../core/Game';

/**
 * Title screen (phase 'menu') — the store-ready main menu: continue/new
 * game with scenario picker, duel entry with trophy badge, leaderboards
 * and a settings dialog. The live game world stays visible behind it.
 */
export function createMainMenu(uiRoot: HTMLElement, game: Game): void {
  const overlay = document.createElement('div');
  overlay.className = 'main-menu';
  overlay.hidden = true;

  // --- Hero ---
  const hero = document.createElement('div');
  hero.className = 'menu-hero';
  const crest = document.createElement('div');
  crest.className = 'menu-crest';
  crest.textContent = '🏰';
  const title = document.createElement('h1');
  title.className = 'menu-title';
  title.textContent = 'Burgspiel';
  const tagline = document.createElement('p');
  tagline.className = 'menu-tagline';
  tagline.textContent = 'Wirtschaft aufbauen · Burg verteidigen · Duelle gewinnen';
  hero.append(crest, title, tagline);

  // --- Primary buttons ---
  const buttons = document.createElement('div');
  buttons.className = 'menu-buttons';

  const continueBtn = document.createElement('button');
  continueBtn.className = 'menu-btn menu-btn-primary';
  continueBtn.textContent = '▶ Weiterspielen';
  continueBtn.addEventListener('click', () => game.setPhase('playing'));

  const newBtn = document.createElement('button');
  newBtn.className = 'menu-btn';
  newBtn.textContent = '🆕 Neues Spiel';
  let confirming = false;
  const scenarioRow = document.createElement('div');
  scenarioRow.className = 'scenario-row';
  scenarioRow.hidden = true;
  for (const id of SCENARIO_IDS) {
    const scenario = getScenario(id);
    const btn = document.createElement('button');
    btn.className = 'scenario-btn';
    const name = document.createElement('span');
    name.textContent = scenario.name;
    const desc = document.createElement('span');
    desc.className = 'scenario-desc';
    desc.textContent = scenario.description;
    btn.append(name, desc);
    btn.addEventListener('click', () => game.restartNewGame(id));
    scenarioRow.appendChild(btn);
  }
  newBtn.addEventListener('click', () => {
    if (game.hasProgress() && !confirming) {
      confirming = true;
      newBtn.textContent = '⚠️ Sicher? Spielstand wird gelöscht!';
      return;
    }
    scenarioRow.hidden = !scenarioRow.hidden;
  });

  const duelBtn = document.createElement('button');
  duelBtn.className = 'menu-btn';
  duelBtn.addEventListener('click', () => {
    game.setPhase('playing');
    events.emit('duel:openMenu', undefined);
  });

  const scoresBtn = document.createElement('button');
  scoresBtn.className = 'menu-btn';
  scoresBtn.textContent = '🏆 Bestenliste';

  const onlineBtn = document.createElement('button');
  onlineBtn.className = 'menu-btn';
  onlineBtn.textContent = '🌐 Online';
  onlineBtn.addEventListener('click', () => events.emit('online:openMenu', undefined));

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'menu-btn';
  settingsBtn.textContent = '⚙️ Einstellungen';

  buttons.append(continueBtn, newBtn, scenarioRow, duelBtn, onlineBtn, scoresBtn, settingsBtn);

  const footer = document.createElement('div');
  footer.className = 'menu-footer';
  footer.textContent = `Burgspiel v${APP_VERSION}`;

  overlay.append(hero, buttons, footer);
  uiRoot.appendChild(overlay);

  // --- Leaderboard dialog ---
  const scoresDlg = document.createElement('div');
  scoresDlg.className = 'pause-overlay menu-dialog';
  scoresDlg.hidden = true;
  const scoresCard = document.createElement('div');
  scoresCard.className = 'pause-card';
  const scoresHeading = document.createElement('h2');
  scoresHeading.textContent = '🏆 Bestenliste';
  const scoresBody = document.createElement('div');
  scoresBody.className = 'menu-scores';
  const scoresClose = document.createElement('button');
  scoresClose.textContent = 'Schließen';
  scoresClose.addEventListener('click', () => (scoresDlg.hidden = true));
  scoresCard.append(scoresHeading, scoresBody, scoresClose);
  scoresDlg.appendChild(scoresCard);
  uiRoot.appendChild(scoresDlg);

  scoresBtn.addEventListener('click', () => {
    scoresBody.replaceChildren();
    const section = (text: string): void => {
      const el = document.createElement('div');
      el.className = 'menu-scores-section';
      el.textContent = text;
      scoresBody.appendChild(el);
    };
    const row = (text: string): void => {
      const el = document.createElement('div');
      el.className = 'menu-scores-row';
      el.textContent = text;
      scoresBody.appendChild(el);
    };
    section('Beste Läufe (Wellen)');
    const scores = loadScores();
    if (scores.length === 0) row('Noch keine Läufe — starte ein neues Spiel!');
    scores.forEach((s, i) => row(`${i + 1}. ${s.waves} Wellen · ${s.kills} Gegner (${s.date})`));
    section('Burg-Duell');
    const rating = loadDuelRating();
    if (rating.wins + rating.losses === 0) {
      row('Noch kein Duell gespielt.');
    } else {
      row(`🏆 ${rating.trophies} Pokale`);
      row(`${rating.wins} Siege · ${rating.losses} Niederlagen`);
      row(`Beste Serie: ${rating.bestStreak}`);
    }
    scoresDlg.hidden = false;
  });

  // --- Settings dialog ---
  const settingsDlg = document.createElement('div');
  settingsDlg.className = 'pause-overlay menu-dialog';
  settingsDlg.hidden = true;
  const settingsCard = document.createElement('div');
  settingsCard.className = 'pause-card';
  const settingsHeading = document.createElement('h2');
  settingsHeading.textContent = '⚙️ Einstellungen';
  const soundBtn = document.createElement('button');
  const soundLabel = (): string => (game.sound.isMuted() ? '🔇 Ton: aus' : '🔊 Ton: an');
  soundBtn.addEventListener('click', () => {
    game.sound.setMuted(!game.sound.isMuted());
    soundBtn.textContent = soundLabel();
  });
  const wipeBtn = document.createElement('button');
  wipeBtn.className = 'danger';
  const WIPE_LABEL = '🗑️ Spielstand löschen';
  wipeBtn.textContent = WIPE_LABEL;
  let wipeConfirming = false;
  wipeBtn.addEventListener('click', () => {
    if (!wipeConfirming) {
      wipeConfirming = true;
      wipeBtn.textContent = 'Sicher? Alles geht verloren!';
      return;
    }
    game.restartNewGame();
    game.setPhase('menu');
    settingsDlg.hidden = true;
  });
  const aboutLine = document.createElement('p');
  aboutLine.className = 'gameover-stats';
  aboutLine.textContent = `Version ${APP_VERSION} · Offline spielbar · Spielstand bleibt auf dem Gerät`;
  const settingsClose = document.createElement('button');
  settingsClose.textContent = 'Schließen';
  settingsClose.addEventListener('click', () => (settingsDlg.hidden = true));

  // --- Legal dialog (Impressum & Datenschutz) ---
  const legalDlg = document.createElement('div');
  legalDlg.className = 'pause-overlay menu-dialog';
  legalDlg.hidden = true;
  const legalCard = document.createElement('div');
  legalCard.className = 'pause-card legal-card';
  const legalHeading = document.createElement('h2');
  legalHeading.textContent = '⚖️ Rechtliches';

  const legalBody = document.createElement('div');
  legalBody.className = 'legal-body';
  legalBody.innerHTML = `
    <h3>Impressum</h3>
    <p>
      <strong>Angaben gemäß § 5 TMG:</strong><br>
      Burgspiel Entwickler-Team<br>
      Musterstraße 42<br>
      12345 Musterstadt<br>
      Deutschland
    </p>
    <p>
      <strong>Kontakt:</strong><br>
      E-Mail: support@burgspiel.de<br>
      Web: <a href="https://burgspiel.de" target="_blank" style="color:var(--ui-accent)">burgspiel.de</a>
    </p>
    
    <h3>Datenschutzerklärung</h3>
    <p>
      Dieses Spiel speichert alle Spielstände lokal auf Ihrem Endgerät. Es werden standardmäßig keine personenbezogenen Daten an unsere Server übertragen.
    </p>
    <p>
      <strong>Werbung (Google AdMob):</strong><br>
      Zur Bereitstellung von optionalen Werbevideos nutzen wir Google AdMob. AdMob erhebt ggf. Werbe-IDs (z.B. Google Advertising ID) und Geräteinformationen, um personalisierte Anzeigen zu schalten und Betrug vorzubeugen.
    </p>
  `;

  const onlinePrivacyBtn = document.createElement('button');
  onlinePrivacyBtn.textContent = '🌐 Online-Datenschutzerklärung';
  onlinePrivacyBtn.addEventListener('click', () => {
    window.open('https://burgspiel.de/privacy', '_system');
  });

  const legalClose = document.createElement('button');
  legalClose.textContent = 'Zurück';
  legalClose.addEventListener('click', () => (legalDlg.hidden = true));

  legalCard.append(legalHeading, legalBody, onlinePrivacyBtn, legalClose);
  legalDlg.appendChild(legalCard);
  uiRoot.appendChild(legalDlg);

  const legalBtn = document.createElement('button');
  legalBtn.textContent = '⚖️ Impressum & Datenschutz';
  legalBtn.addEventListener('click', () => {
    legalDlg.hidden = false;
  });

  settingsCard.append(settingsHeading, soundBtn, wipeBtn, legalBtn, aboutLine, settingsClose);
  settingsDlg.appendChild(settingsCard);
  uiRoot.appendChild(settingsDlg);

  settingsBtn.addEventListener('click', () => {
    wipeConfirming = false;
    wipeBtn.textContent = WIPE_LABEL;
    soundBtn.textContent = soundLabel();
    settingsDlg.hidden = false;
  });

  events.on('game:phaseChanged', ({ phase }) => {
    overlay.hidden = phase !== 'menu';
    if (phase !== 'menu') {
      scoresDlg.hidden = true;
      settingsDlg.hidden = true;
      legalDlg.hidden = true;
      return;
    }
    confirming = false;
    newBtn.textContent = '🆕 Neues Spiel';
    scenarioRow.hidden = true;
    continueBtn.hidden = !game.hasProgress();
    const rating = loadDuelRating();
    duelBtn.textContent =
      rating.trophies > 0 ? `⚔️ Burg-Duell · 🏆 ${rating.trophies}` : '⚔️ Burg-Duell';
  });
}
