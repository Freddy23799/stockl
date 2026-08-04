const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:5174';
const API_URL = 'http://localhost:3010/api';
let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, '0')}] ${msg}`);
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (err) => console.log('  [page error]', err.message));

  await page.goto(`${BASE_URL}/login`);
  await page.fill('#email', 'admin@machibel.local');
  await page.fill('#password', 'ChangeMoi123!');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE_URL}/`);
  log('Login admin OK');

  const token = await page.evaluate(() => localStorage.getItem('token'));

  const request = await import('playwright').then((pw) => pw.request.newContext());
  async function apiGet(path) {
    const res = await request.get(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return res;
  }

  // --- Etat initial : tout actif ---
  await page.goto(`${BASE_URL}/`);
  let sidebar = await page.locator('.sidebar nav').textContent();
  if (!sidebar.includes('Ventes') || !sidebar.includes('Fournisseurs') || !sidebar.includes('Dépenses')) {
    throw new Error('Tous les modules devraient etre visibles au depart');
  }
  log('Etat initial: tous les modules actifs et visibles dans le menu');

  // ============================================================
  // DESACTIVER VENTES
  // ============================================================
  await page.goto(`${BASE_URL}/parametres`);
  await page.waitForSelector('h2:has-text("Modules actifs")');
  await page.locator('.module-toggle', { hasText: 'Ventes' }).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(500);
  log('Module Ventes desactive via Parametres');

  sidebar = await page.locator('.sidebar nav').textContent();
  if (sidebar.includes('Vendeuses') || sidebar.match(/\bVentes\b/)) {
    throw new Error('Vendeuses/Ventes ne devraient plus apparaitre dans le menu');
  }
  log('Menu reorganise: Vendeuses et Ventes ont disparu');

  await page.goto(`${BASE_URL}/ventes`);
  await page.waitForURL(`${BASE_URL}/`);
  log('Acces direct a /ventes redirige vers le dashboard');

  await page.goto(`${BASE_URL}/vendeuses`);
  await page.waitForURL(`${BASE_URL}/`);
  log('Acces direct a /vendeuses redirige vers le dashboard');

  let res = await apiGet('/ventes');
  if (res.status() !== 403) throw new Error(`GET /ventes devrait renvoyer 403, recu ${res.status()}`);
  let body = await res.json();
  if (body.code !== 'MODULE_DESACTIVE') throw new Error('Code MODULE_DESACTIVE attendu');
  log('Appel API direct a /api/ventes bloque avec 403 MODULE_DESACTIVE (pas juste cache cote ecran)');

  res = await apiGet('/vendeuses');
  if (res.status() !== 403) throw new Error(`GET /vendeuses devrait renvoyer 403, recu ${res.status()}`);
  log('Appel API direct a /api/vendeuses egalement bloque');

  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('.card-grid');
  let dashTexte = await page.locator('main').textContent();
  if (dashTexte.includes("Chiffre d'affaires") || dashTexte.includes('Ventes (aujourd')) {
    throw new Error('Le dashboard ne devrait plus montrer les tuiles liees aux ventes');
  }
  if (!dashTexte.includes('Bilan net')) {
    throw new Error('Bilan net devrait rester visible (Depenses toujours actif)');
  }
  log('Dashboard reorganise: tuiles CA/Ventes disparues, Bilan net conserve (Depenses actif)');

  await page.goto(`${BASE_URL}/rapports`);
  await page.waitForSelector('#apercu-rapport');
  let rapportTexte = await page.locator('#apercu-rapport').textContent();
  if (rapportTexte.includes('CA direct') || rapportTexte.includes('Detail par vendeuse')) {
    throw new Error('Le rapport ne devrait plus montrer les sections liees aux ventes');
  }
  if (!rapportTexte.includes('Depenses')) {
    throw new Error('La section Depenses devrait rester visible dans le rapport');
  }
  log('Rapports reorganise: section ventes/vendeuse disparue, Depenses conservee');

  // ============================================================
  // REACTIVER VENTES, DESACTIVER FOURNISSEURS
  // ============================================================
  await page.goto(`${BASE_URL}/parametres`);
  await page.locator('.module-toggle', { hasText: 'Ventes' }).locator('input[type=checkbox]').check();
  await page.waitForTimeout(500);
  await page.locator('.module-toggle', { hasText: 'Fournisseurs' }).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(500);
  log('Ventes reactive, Fournisseurs desactive');

  sidebar = await page.locator('.sidebar nav').textContent();
  if (!sidebar.includes('Ventes') || sidebar.includes('Fournisseurs')) {
    throw new Error('Menu devrait montrer Ventes mais plus Fournisseurs');
  }
  log('Menu confirme: Ventes de retour, Fournisseurs disparu');

  await page.goto(`${BASE_URL}/fournisseurs`);
  await page.waitForURL(`${BASE_URL}/`);
  log('Acces direct a /fournisseurs redirige vers le dashboard');

  res = await apiGet('/fournisseurs');
  if (res.status() !== 403) throw new Error(`GET /fournisseurs devrait renvoyer 403, recu ${res.status()}`);
  log('Appel API direct a /api/fournisseurs bloque avec 403');

  await page.goto(`${BASE_URL}/stock`);
  const formEntree = page.locator('form').filter({ hasText: 'Quantite achetee' });
  const texteFormEntree = await formEntree.textContent();
  if (texteFormEntree.includes('Fournisseur')) {
    throw new Error('Le formulaire d\'entree de stock ne devrait plus montrer le champ Fournisseur');
  }
  log('Formulaire "Entree de stock" reorganise: champ Fournisseur disparu');

  // Tenter de forcer un fournisseur_id via l'API directement doit echouer
  const resEntreeForcee = await request.post(`${API_URL}/stock/entrees`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { produit_id: 1, quantite_achat: 1, cout_achat_total: 1000, fournisseur_id: 1 },
  });
  if (resEntreeForcee.status() !== 403) {
    throw new Error(`POST /stock/entrees avec fournisseur_id force devrait renvoyer 403, recu ${resEntreeForcee.status()}`);
  }
  log('Tentative de forcer fournisseur_id via API directe correctement bloquee (403)');

  // ============================================================
  // DESACTIVER AUSSI DEPENSES (Ventes + Fournisseurs restent actifs sauf Fournisseurs deja off)
  // ============================================================
  await page.goto(`${BASE_URL}/parametres`);
  await page.locator('.module-toggle', { hasText: 'Depenses' }).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(500);
  log('Module Depenses desactive (Ventes reste actif)');

  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('.card-grid');
  dashTexte = await page.locator('main').textContent();
  if (dashTexte.includes('Dernieres depenses')) {
    throw new Error('Le bloc "Dernieres depenses" ne devrait plus apparaitre');
  }
  if (!dashTexte.includes("Chiffre d'affaires")) {
    throw new Error('Les tuiles ventes devraient etre revenues (Ventes reactive)');
  }
  log('Dashboard: bloc Depenses disparu, tuiles Ventes de retour');

  // ============================================================
  // TOUT DESACTIVER (Ventes + Depenses) -> message explicite
  // ============================================================
  await page.goto(`${BASE_URL}/parametres`);
  await page.locator('.module-toggle', { hasText: 'Ventes' }).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(500);
  log('Ventes desactive en plus -> plus aucun module financier actif');

  await page.goto(`${BASE_URL}/rapports`);
  await page.waitForSelector('text=Aucun module de suivi financier');
  log('Rapports affiche le message explicatif (rien a rapporter) au lieu d\'une page vide/cassee');

  await page.goto(`${BASE_URL}/`);
  await page.waitForSelector('.card-grid');
  dashTexte = await page.locator('main').textContent();
  if (!dashTexte.includes('se limite au suivi du stock')) {
    throw new Error('Le dashboard devrait expliquer qu\'il se limite au suivi du stock');
  }
  if (!dashTexte.includes('Alertes de stock') && !dashTexte.includes('Produits en alerte')) {
    throw new Error('Le suivi du stock (noyau) devrait rester visible');
  }
  log('Dashboard confirme: se recentre sur le stock (noyau toujours actif), rien de casse');

  // ============================================================
  // TOUT REACTIVER (nettoyage, pour laisser le systeme dans l'etat par defaut)
  // ============================================================
  await page.goto(`${BASE_URL}/parametres`);
  await page.locator('.module-toggle', { hasText: 'Ventes' }).locator('input[type=checkbox]').check();
  await page.waitForTimeout(500);
  await page.locator('.module-toggle', { hasText: 'Fournisseurs' }).locator('input[type=checkbox]').check();
  await page.waitForTimeout(500);
  await page.locator('.module-toggle', { hasText: 'Depenses' }).locator('input[type=checkbox]').check();
  await page.waitForTimeout(500);
  sidebar = await page.locator('.sidebar nav').textContent();
  if (!sidebar.includes('Ventes') || !sidebar.includes('Fournisseurs') || !sidebar.includes('Dépenses')) {
    throw new Error('Tous les modules devraient etre reactives');
  }
  log('Tous les modules reactives, systeme remis dans son etat par defaut');

  await request.dispose();
  await browser.close();
  console.log('\nTOUS LES TESTS DE MODULES SONT PASSES.');
}

run().catch((err) => {
  console.error('\nECHEC:', err.message);
  process.exit(1);
});
