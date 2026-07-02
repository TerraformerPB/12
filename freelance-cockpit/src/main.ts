import { store, todayISO } from './store';
import { dueFollowUps } from './ui/crm';
import { upcomingAlerts } from './domain/inventory';
import { el } from './ui/helpers';
import { renderDashboard } from './ui/dashboard';
import { renderCrm } from './ui/crm';
import { renderBilling } from './ui/billing';
import { renderProjects } from './ui/projects';
import { renderFinance } from './ui/finance';
import { renderAssets } from './ui/assets';
import { renderContracts } from './ui/contracts';
import { renderWebsite } from './ui/website';
import { renderSettings } from './ui/settings';

interface Route {
  hash: string;
  label: string;
  render: (root: HTMLElement) => void;
  badgeCount?: () => number;
}

const ROUTES: Route[] = [
  { hash: '#/dashboard', label: 'Dashboard', render: renderDashboard },
  { hash: '#/crm', label: 'CRM & Leads', render: renderCrm, badgeCount: () => dueFollowUps().length },
  { hash: '#/belege', label: 'Angebote & Rechnungen', render: renderBilling },
  { hash: '#/projekte', label: 'Projekte & Zeiten', render: renderProjects },
  { hash: '#/finanzen', label: 'Finanzen / EÜR', render: renderFinance },
  {
    hash: '#/inventar', label: 'Inventar & Abos', render: renderAssets,
    badgeCount: () => upcomingAlerts(store.state.assets, todayISO(), 30).length,
  },
  { hash: '#/vertraege', label: 'Verträge & Dokumente', render: renderContracts },
  { hash: '#/website', label: 'Onlineauftritt', render: renderWebsite },
  { hash: '#/einstellungen', label: 'Einstellungen', render: renderSettings },
];

const app = document.getElementById('app')!;

function currentRoute(): Route {
  return ROUTES.find((r) => r.hash === location.hash) ?? ROUTES[0];
}

function render(): void {
  const active = currentRoute();
  app.replaceChildren();

  const nav = el('nav', { class: 'sidebar' },
    el('div', { class: 'logo' }, 'Freelance Cockpit', el('small', {}, 'Business-Suite für Software-Freelancer')),
  );
  for (const route of ROUTES) {
    const count = route.badgeCount?.() ?? 0;
    nav.append(
      el(
        'a',
        { href: route.hash, class: route === active ? 'active' : '' },
        el('span', {}, route.label),
        count > 0 ? el('span', { class: 'nav-badge' }, String(count)) : null,
      ),
    );
  }

  const main = el('main', { class: 'main' });
  active.render(main);
  app.append(nav, main);
}

window.addEventListener('hashchange', render);
document.addEventListener('rerender', render);
store.subscribe(render);
render();
