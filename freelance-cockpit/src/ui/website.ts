import { store, uid } from '../store';
import type { PortfolioProject } from '../types';
import { createLeadFromWebsiteForm } from '../actions';
import {
  confirmModal, download, el, emptyHint, field, fieldRow, modal, section,
  table, textArea, textInput, toast,
} from './helpers';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- Rechtstexte ----------

export function impressumText(): string {
  const s = store.state.settings;
  return (
    'Impressum\n\nAngaben gemäß § 5 DDG\n\n' +
    `${s.companyName || s.ownerName}\n${s.address}\n\n` +
    `Kontakt:\nTelefon: ${s.phone}\nE-Mail: ${s.email}\n\n` +
    (s.vatId ? `Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG:\n${s.vatId}\n\n` : '') +
    (s.taxNumber && !s.vatId ? `Steuernummer: ${s.taxNumber}\n\n` : '') +
    `Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV:\n${s.ownerName}, Anschrift wie oben\n\n` +
    'EU-Streitschlichtung: Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: ' +
    'https://ec.europa.eu/consumers/odr/. Zur Teilnahme an einem Streitbeilegungsverfahren vor einer ' +
    'Verbraucherschlichtungsstelle sind wir nicht verpflichtet und nicht bereit.'
  );
}

export function datenschutzText(): string {
  const s = store.state.settings;
  return (
    'Datenschutzerklärung\n\n1. Verantwortlicher\n' +
    `${s.companyName || s.ownerName}\n${s.address}\nE-Mail: ${s.email}\n\n` +
    '2. Hosting und Server-Logs\nBeim Aufruf dieser Website verarbeitet der Hoster automatisch technisch notwendige ' +
    'Daten (IP-Adresse, Datum/Uhrzeit, aufgerufene Seite, User-Agent) auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO ' +
    '(berechtigtes Interesse am sicheren Betrieb). Die Logs werden nach kurzer Zeit gelöscht.\n\n' +
    '3. Kontaktaufnahme\nWenn Sie das Kontaktformular nutzen oder per E-Mail anfragen, verarbeiten wir Ihre Angaben ' +
    '(Name, E-Mail-Adresse, Nachricht) zur Bearbeitung der Anfrage (Art. 6 Abs. 1 lit. b DSGVO). Die Daten werden ' +
    'gelöscht, sobald sie für die Bearbeitung nicht mehr erforderlich sind und keine gesetzlichen ' +
    'Aufbewahrungspflichten bestehen.\n\n' +
    '4. Ihre Rechte\nSie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), ' +
    'Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) sowie Widerspruch (Art. 21). ' +
    'Außerdem besteht ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde.\n\n' +
    '5. Keine Cookies / kein Tracking\nDiese Website setzt keine Tracking-Cookies und keine Analyse-Tools ein.\n\n' +
    'HINWEIS: Automatisch generierter Mustertext — bitte auf den tatsächlichen Funktionsumfang der Website anpassen.'
  );
}

// ---------- Portfolio-HTML ----------

export function portfolioHtml(): string {
  const s = store.state.settings;
  const name = s.companyName || s.ownerName;
  const skills = s.website.skills.split(',').map((x) => x.trim()).filter(Boolean);
  const projects = s.website.portfolio
    .map(
      (p) => `<article class="project"><h3>${esc(p.title)}</h3><p>${esc(p.description)}</p><p class="tech">${esc(p.tech)}</p></article>`,
    )
    .join('\n');
  const mailSubject = encodeURIComponent('Projektanfrage über ' + name);
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Softwareentwicklung</title>
<style>
  :root { --accent: #2563eb; --text: #1d2733; --muted: #64748b; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: var(--text); margin: 0; line-height: 1.6; }
  header { background: #101827; color: #fff; padding: 64px 24px; text-align: center; }
  header h1 { margin: 0 0 8px; font-size: 32px; }
  header p { color: #cbd5e1; max-width: 560px; margin: 0 auto; }
  main { max-width: 860px; margin: 0 auto; padding: 32px 24px; }
  h2 { border-bottom: 2px solid var(--accent); padding-bottom: 6px; display: inline-block; }
  .skills span { display: inline-block; background: #dbeafe; color: var(--accent); border-radius: 999px; padding: 4px 14px; margin: 0 6px 8px 0; font-size: 14px; }
  .project { border: 1px solid #dde3ec; border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
  .project h3 { margin: 0 0 6px; }
  .project .tech { color: var(--muted); font-size: 13px; margin-bottom: 0; }
  form { display: grid; gap: 12px; max-width: 480px; }
  input, textarea { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; font: inherit; }
  button { background: var(--accent); color: #fff; border: 0; border-radius: 8px; padding: 12px; font-size: 15px; cursor: pointer; }
  footer { background: #f4f6f9; padding: 24px; text-align: center; font-size: 13px; color: var(--muted); }
  footer a { color: var(--muted); margin: 0 10px; }
  section.legal { display: none; }
  section.legal:target { display: block; }
  pre { white-space: pre-wrap; font: inherit; background: #f8fafc; border: 1px solid #dde3ec; border-radius: 8px; padding: 16px; }
</style></head><body>
<header>
  <h1>${esc(name)}</h1>
  <p>${esc(s.website.tagline)}</p>
</header>
<main>
  <h2>Leistungen & Skills</h2>
  <p class="skills">${skills.map((x) => `<span>${esc(x)}</span>`).join('')}</p>
  <h2>Referenzen</h2>
  ${projects || '<p>Projekte folgen in Kürze.</p>'}
  <h2>Kontakt</h2>
  <p>Erzählen Sie mir von Ihrem Projekt — ich melde mich innerhalb eines Werktags.</p>
  <form id="contact" onsubmit="event.preventDefault();
    var f = event.target;
    location.href = 'mailto:${esc(s.email)}?subject=${mailSubject}'
      + '&body=' + encodeURIComponent('Name: ' + f.name.value + '\\nFirma: ' + f.company.value + '\\nE-Mail: ' + f.email.value + '\\n\\n' + f.message.value);">
    <input name="name" placeholder="Ihr Name" required>
    <input name="company" placeholder="Firma (optional)">
    <input name="email" type="email" placeholder="Ihre E-Mail" required>
    <textarea name="message" rows="5" placeholder="Worum geht es?" required></textarea>
    <button type="submit">Anfrage senden</button>
  </form>
  <section class="legal" id="impressum"><h2>Impressum</h2><pre>${esc(impressumText())}</pre></section>
  <section class="legal" id="datenschutz"><h2>Datenschutz</h2><pre>${esc(datenschutzText())}</pre></section>
</main>
<footer>
  © ${new Date().getFullYear()} ${esc(name)}
  <a href="#impressum">Impressum</a>
  <a href="#datenschutz">Datenschutz</a>
</footer>
</body></html>`;
}

// ---------- Portfolio-Projekte verwalten ----------

function portfolioModal(existing?: PortfolioProject): void {
  const p: PortfolioProject = existing ?? { id: uid(), title: '', description: '', tech: '' };
  const title = textInput(p.title);
  const description = textArea(p.description, 3);
  const tech = textInput(p.tech, { placeholder: 'z. B. React, Node.js, PostgreSQL' });
  modal(existing ? 'Referenz bearbeiten' : 'Neue Referenz', el(
    'div', {},
    field('Titel', title),
    field('Beschreibung', description),
    field('Technologien', tech),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Speichern',
      primary: true,
      onClick: (close) => {
        if (!title.value.trim()) { toast('Titel fehlt.'); return; }
        p.title = title.value.trim();
        p.description = description.value;
        p.tech = tech.value.trim();
        store.update((s) => {
          if (!existing) s.settings.website.portfolio.push(p);
        });
        close();
      },
    },
  ]);
}

/** Simuliert eine eingehende Formular-Anfrage → legt Kontakt + Lead an. */
function simulateFormModal(): void {
  const name = textInput('', { placeholder: 'Name des Interessenten' });
  const company = textInput('');
  const email = textInput('');
  const message = textArea('', 4);
  modal('Kontaktformular-Eingang simulieren', el(
    'div', {},
    el('p', { class: 'muted' },
      'So sieht der Datenfluss live aus: Formular → Kontakt + Lead in der CRM-Pipeline (Phase „Kontakt“, Follow-up in 2 Tagen).'),
    fieldRow(field('Name', name), field('Firma', company)),
    field('E-Mail', email),
    field('Nachricht', message),
  ), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Absenden',
      primary: true,
      onClick: (close) => {
        if (!name.value.trim() || !email.value.trim()) { toast('Name und E-Mail angeben.'); return; }
        createLeadFromWebsiteForm({
          name: name.value.trim(),
          company: company.value.trim(),
          email: email.value.trim(),
          message: message.value.trim(),
        });
        toast('Lead angelegt — im CRM in der Spalte „Kontakt“.');
        close();
      },
    },
  ]);
}

export function renderWebsite(root: HTMLElement): void {
  const s = store.state.settings;
  const tagline = textInput(s.website.tagline);
  const skills = textInput(s.website.skills);

  root.append(
    el('h1', {}, 'Onlineauftritt'),
    el('p', { class: 'subtitle' }, 'Portfolio-Site mit Referenzen, Kontaktformular (schreibt Leads ins CRM) und Rechtstext-Generator.'),
    section(
      'Portfolio-Inhalte',
      field('Tagline', tagline),
      field('Skills (kommagetrennt)', skills),
      el('button', { class: 'btn primary', onclick: () => {
        store.update((st) => {
          st.settings.website.tagline = tagline.value;
          st.settings.website.skills = skills.value;
        });
        toast('Gespeichert.');
      } }, 'Speichern'),
    ),
    section(
      'Referenzen',
      el('div', { class: 'toolbar' }, el('button', { class: 'btn', onclick: () => portfolioModal() }, '+ Referenz')),
      s.website.portfolio.length
        ? table(
            ['Titel', 'Technologien', ''],
            s.website.portfolio.map((p) => [
              p.title,
              p.tech,
              el(
                'span', {},
                el('button', { class: 'btn small', onclick: () => portfolioModal(p) }, 'Bearbeiten'),
                ' ',
                el('button', { class: 'btn small danger', onclick: () =>
                  confirmModal(`Referenz „${p.title}“ löschen?`, () =>
                    store.update((st) => {
                      st.settings.website.portfolio = st.settings.website.portfolio.filter((x) => x.id !== p.id);
                    })),
                }, 'Löschen'),
              ),
            ]),
          )
        : emptyHint('Noch keine Referenzen — z. B. abgeschlossene Projekte eintragen.'),
    ),
    section(
      'Website erzeugen',
      el('p', { class: 'muted' },
        'Export als eigenständige HTML-Datei (inkl. Impressum & Datenschutz, Kontaktformular per E-Mail). ' +
        'Bei echtem Hosting kann das Formular an einen Webhook zeigen, der Leads direkt ins CRM schreibt — ' +
        'die Simulation unten zeigt genau diesen Datenfluss.'),
      el(
        'div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: () => {
          download('portfolio.html', portfolioHtml(), 'text/html;charset=utf-8');
          toast('portfolio.html heruntergeladen — direkt hostbar (z. B. nginx, GitHub Pages).');
        } }, 'Portfolio-HTML exportieren'),
        el('button', { class: 'btn', onclick: () => {
          const win = window.open('', '_blank');
          if (!win) { toast('Popup blockiert.'); return; }
          win.document.write(portfolioHtml());
          win.document.close();
        } }, 'Vorschau öffnen'),
        el('button', { class: 'btn', onclick: () => simulateFormModal() }, 'Kontaktformular-Eingang simulieren → Lead'),
      ),
    ),
    section(
      'Rechtstexte (Generator)',
      el(
        'div', { class: 'toolbar' },
        el('button', { class: 'btn', onclick: () => download('impressum.txt', impressumText(), 'text/plain;charset=utf-8') }, 'Impressum herunterladen'),
        el('button', { class: 'btn', onclick: () => download('datenschutz.txt', datenschutzText(), 'text/plain;charset=utf-8') }, 'Datenschutzerklärung herunterladen'),
      ),
      el('pre', { class: 'doc-preview' }, impressumText() + '\n\n————————————————\n\n' + datenschutzText()),
    ),
  );
}
