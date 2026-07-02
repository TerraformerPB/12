type Attrs = Record<string, string | number | boolean | ((ev: Event) => void)>;
type Child = Node | string | null | undefined;

/** Kleiner DOM-Builder: el('div', { class: 'card', onclick: … }, kinder…) */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else if (typeof value !== 'function') {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function textInput(value: string, attrs: Attrs = {}): HTMLInputElement {
  const input = el('input', { type: 'text', ...attrs });
  input.value = value;
  return input;
}

export function numberInput(value: number, attrs: Attrs = {}): HTMLInputElement {
  const input = el('input', { type: 'number', step: '0.01', ...attrs });
  input.value = String(value);
  return input;
}

export function dateInput(value: string, attrs: Attrs = {}): HTMLInputElement {
  const input = el('input', { type: 'date', ...attrs });
  input.value = value;
  return input;
}

export function textArea(value: string, rows = 4, attrs: Attrs = {}): HTMLTextAreaElement {
  const area = el('textarea', { rows, ...attrs });
  area.value = value;
  return area;
}

export function selectInput(
  options: { value: string; label: string }[],
  selected: string,
  attrs: Attrs = {},
): HTMLSelectElement {
  const sel = el('select', attrs);
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === selected) opt.selected = true;
    sel.append(opt);
  }
  return sel;
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input);
}

export function fieldRow(...fields: HTMLElement[]): HTMLElement {
  return el('div', { class: 'field-row' }, ...fields);
}

/** Modal mit Titel, Inhalt und Aktionen. Gibt close() zurück. */
export function modal(
  title: string,
  body: HTMLElement,
  actions: { label: string; primary?: boolean; onClick: (close: () => void) => void }[],
): () => void {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  const buttons = actions.map((a) =>
    el('button', { class: a.primary ? 'btn primary' : 'btn', onclick: () => a.onClick(close) }, a.label),
  );
  const box = el(
    'div',
    { class: 'modal' },
    el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'btn ghost', onclick: close }, '✕')),
    el('div', { class: 'modal-body' }, body),
    el('div', { class: 'modal-actions' }, ...buttons),
  );
  overlay.append(box);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });
  document.body.append(overlay);
  return close;
}

export function confirmModal(question: string, onYes: () => void): void {
  modal('Bestätigen', el('p', {}, question), [
    { label: 'Abbrechen', onClick: (close) => close() },
    {
      label: 'Ja, fortfahren',
      primary: true,
      onClick: (close) => {
        close();
        onYes();
      },
    },
  ]);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast' }, message);
  document.body.append(t);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3200);
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Öffnet ein Druckfenster (Browser-Druckdialog → „Als PDF speichern“). */
export function openPrintWindow(html: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    toast('Popup blockiert — bitte Popups für diese Seite erlauben.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

export function copyToClipboard(text: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast('In die Zwischenablage kopiert.'))
    .catch(() => toast('Kopieren fehlgeschlagen.'));
}

export function table(headers: string[], rows: (Node | string)[][]): HTMLElement {
  const thead = el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h))));
  const tbody = el('tbody', {});
  for (const row of rows) {
    tbody.append(el('tr', {}, ...row.map((cell) => el('td', {}, cell))));
  }
  return el('table', { class: 'data-table' }, thead, tbody);
}

export function emptyHint(text: string): HTMLElement {
  return el('p', { class: 'empty-hint' }, text);
}

export function badge(text: string, variant: '' | 'ok' | 'warn' | 'danger' | 'info' = ''): HTMLElement {
  return el('span', { class: `badge ${variant}` }, text);
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return el('section', { class: 'card' }, el('h2', {}, title), ...children);
}
