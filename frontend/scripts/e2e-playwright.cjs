const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:5174';
let step = 0;
function log(msg) {
  step += 1;
  console.log(`[${String(step).padStart(2, '0')}] ${msg}`);
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [console error]', msg.text());
  });
  page.on('pageerror', (err) => console.log('  [page error]', err.message));

  // --- Login admin ---
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#email', 'admin@machibel.local');
  await page.fill('#password', 'ChangeMoi123!');
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE_URL}/`);
  log('Login admin OK -> tableau de bord');

  await page.waitForSelector('h1:has-text("Tableau de bord")');
  log('Dashboard affiche');

  // --- Fournisseur ---
  await page.goto(`${BASE_URL}/fournisseurs`);
  await page.click('button:has-text("Nouveau fournisseur")');
  await page.fill('.modal-box input >> nth=0', 'Distributeur Cosmetique SARL');
  await page.click('.modal-box button:has-text("Enregistrer")');
  await page.waitForSelector('td:has-text("Distributeur Cosmetique SARL")');
  log('Fournisseur cree');

  // --- Produit ---
  await page.goto(`${BASE_URL}/produits`);
  await page.click('button:has-text("Nouveau produit")');
  const form = page.locator('.modal-box form');
  await form.locator('input').nth(0).fill('Parfum Chanel N5');
  await form.locator('input').nth(1).fill('45000');
  await form.locator('input').nth(2).fill('piece');
  await form.locator('input').nth(3).fill('carton');
  await form.locator('input').nth(4).fill('24');
  await form.locator('input').nth(5).fill('5');
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('td:has-text("Parfum Chanel N5")');
  log('Produit cree');

  // --- Historique prix (doit etre vide au depart) ---
  await page.click('tr:has-text("Parfum Chanel N5") >> button:has-text("Historique prix")');
  await page.waitForSelector('.modal-box:has-text("Historique des prix")');
  const histoVide = await page.locator('.modal-box').textContent();
  if (!histoVide.includes('Aucun changement de prix')) throw new Error('Historique prix devrait etre vide');
  log('Historique prix vide confirme');
  await page.click('.modal-close');

  // --- Modifier le prix (doit apparaitre dans historique) ---
  await page.click('tr:has-text("Parfum Chanel N5") >> button:has-text("Modifier")');
  const editForm = page.locator('.modal-box form');
  await editForm.locator('input').nth(1).fill('48000');
  await editForm.locator('button[type=submit]').click();
  await page.waitForSelector('td:has-text("48")');
  log('Prix modifie a 48000');

  await page.click('tr:has-text("Parfum Chanel N5") >> button:has-text("Historique prix")');
  await page.waitForSelector('.modal-box:has-text("45")');
  log('Changement de prix trace dans l\'historique');
  await page.click('.modal-close');

  // --- Stock : entree ---
  await page.goto(`${BASE_URL}/stock`);
  await page.locator('select').nth(0).selectOption({ index: 1 });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  const stockForm = page.locator('form').filter({ hasText: 'Quantite achetee' });
  await stockForm.locator('input[type=number] >> nth=0').fill('2');
  await stockForm.locator('input[type=number] >> nth=1').fill('480000');
  await stockForm.locator('button[type=submit]').click();
  await page.waitForSelector('td:has-text("48")');
  log('Entree de stock enregistree (48 pieces)');

  // --- Vendeuse (fiche de reference, pas de compte) : recuperer son code a 6 chiffres ---
  await page.goto(`${BASE_URL}/vendeuses`);
  await page.click('button:has-text("Nouvelle vendeuse")');
  await page.locator('.modal-box input').nth(0).fill('Aicha Traore');
  await page.click('.modal-box button:has-text("Enregistrer")');
  await page.waitForSelector('.modal-box p[style*="32px"]');
  const codeVendeuse = (await page.locator('.modal-box p[style*="32px"]').textContent()).trim();
  if (!/^\d{6}$/.test(codeVendeuse)) throw new Error(`Code vendeuse invalide recupere: "${codeVendeuse}"`);
  log(`Vendeuse creee, code genere automatiquement: ${codeVendeuse}`);
  await page.click('.modal-box button:has-text("Fermer")');
  await page.waitForSelector(`td code:has-text("${codeVendeuse}")`);
  log('Code affiche dans la liste des vendeuses');

  // --- Vente directe ---
  await page.goto(`${BASE_URL}/ventes`);
  // nth(0) = "Type de vente" (toujours "Directe" par defaut), nth(1) = selection du produit
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.fill('input[type=number]', '10');
  await page.click('button:has-text("Ajouter")');
  await page.waitForSelector('td:has-text("Parfum Chanel N5")');
  await page.click('button:has-text("Valider la vente")');
  await page.waitForSelector('td:has-text("Directe")');
  log('Vente directe enregistree (10 pieces)');

  // --- Vente attribuee via le code de la vendeuse (le mecanisme d'identification) ---
  await page.locator('select').nth(0).selectOption({ label: 'Attribuee a une vendeuse' });
  await page.fill('input[maxlength="6"]', codeVendeuse);
  await page.waitForSelector('.badge.success:has-text("Aicha Traore")', { timeout: 5000 });
  log('Code reconnu -> vendeuse identifiee comme "Aicha Traore"');
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.fill('input[type=number]', '3');
  await page.click('button:has-text("Ajouter")');
  await page.click('button:has-text("Valider la vente")');
  await page.waitForSelector('td:has-text("Aicha Traore")');
  log('Vente attribuee a la vendeuse via son code (3 pieces)');

  // --- Verifier stock decremente (48 - 10 - 3 = 35) ---
  await page.goto(`${BASE_URL}/stock`);
  await page.waitForSelector('td:has-text("35")');
  log('Stock decremente correctement pour les deux ventes (35 restants)');

  // --- Code invalide : doit etre rejete ---
  await page.goto(`${BASE_URL}/ventes`);
  await page.locator('select').nth(0).selectOption({ label: 'Attribuee a une vendeuse' });
  await page.fill('input[maxlength="6"]', '000000');
  await page.waitForSelector('.error-message:has-text("Aucune vendeuse")', { timeout: 5000 });
  log('Code inexistant correctement rejete');

  // --- Vente avec stock insuffisant : doit afficher une erreur ---
  await page.locator('select').nth(0).selectOption({ label: 'Directe (boutique)' });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.fill('input[type=number]', '9999');
  await page.click('button:has-text("Ajouter")');
  await page.click('button:has-text("Valider la vente")');
  await page.waitForSelector('.error-message');
  const erreurTexte = await page.locator('.error-message').textContent();
  if (!erreurTexte.toLowerCase().includes('stock')) throw new Error('Message d\'erreur stock insuffisant attendu');
  log(`Blocage stock insuffisant confirme: "${erreurTexte}"`);

  // --- Depense ---
  await page.goto(`${BASE_URL}/depenses`);
  await page.fill('input[placeholder*="electricite"]', 'Electricite');
  await page.locator('input[type=number]').fill('25000');
  await page.click('button:has-text("Enregistrer")');
  await page.waitForSelector('td:has-text("Electricite")');
  log('Depense enregistree');

  // --- Rapport journalier global ---
  await page.goto(`${BASE_URL}/rapports`);
  await page.waitForSelector('#apercu-rapport');
  let rapportTexte = await page.locator('#apercu-rapport').textContent();
  if (!rapportTexte.includes('Aicha Traore')) throw new Error('Le detail par vendeuse devrait lister Aicha Traore');
  log('Rapport journalier global liste bien "Aicha Traore" dans le detail par vendeuse');

  // --- Rapport filtre sur la vendeuse ---
  await page.selectOption('.card.no-print select', { label: `Aicha Traore — ${codeVendeuse}` });
  await page.waitForSelector('#apercu-rapport:has-text("Performance de la vendeuse")');
  rapportTexte = await page.locator('#apercu-rapport').textContent();
  if (!rapportTexte.includes('Aicha Traore')) throw new Error('Le rapport filtre devrait afficher Aicha Traore');
  log('Rapport filtre sur une vendeuse specifique fonctionne (via son nom/code)');

  // --- Hebdomadaire, toujours filtre sur la vendeuse ---
  await page.click('button:has-text("Hebdomadaire")');
  await page.waitForSelector('#apercu-rapport:has-text("Performance de la vendeuse")');
  log('Filtre vendeuse conserve en changeant de periode (hebdomadaire)');

  // --- Historique / audit ---
  await page.goto(`${BASE_URL}/historique`);
  await page.waitForSelector('td:has-text("vente_creation")');
  log('Historique/audit affiche les operations');

  // --- Parametres : upload logo + methode ---
  await page.goto(`${BASE_URL}/parametres`);
  await page.waitForSelector('h2:has-text("Logo")');
  await page.selectOption('select', { label: 'FIFO (premier entre, premier sorti)' });
  await page.click('button:has-text("Enregistrer")');
  await page.waitForSelector('text=mise a jour');
  log('Methode de valorisation changee en FIFO');

  // --- Comptes administrateurs : plus de notion de compte vendeuse ---
  const compteTexte = await page.locator('.card').filter({ hasText: 'Comptes administrateurs' }).textContent();
  if (compteTexte.toLowerCase().includes('vendeuse') === false) throw new Error('La note explicative sur les vendeuses devrait etre presente');
  log('Section Comptes administrateurs confirmee (pas de gestion de compte vendeuse)');

  await browser.close();
  console.log('\nTOUS LES TESTS SONT PASSES.');
}

run().catch((err) => {
  console.error('\nECHEC:', err.message);
  process.exit(1);
});
