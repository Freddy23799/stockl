# RBAC et perimetres de donnees

## Principe

Chaque decision d'acces est prise par le backend avec le triplet `module + action + perimetre`. L'interface consomme la meme matrice uniquement pour composer le menu : elle ne constitue jamais une barriere de securite.

L'ordre de decision est : compte actif, entreprise active, role, surcharge nominative, permission, puis filtre de perimetre sur la donnee. Toute action sensible est journalisee dans `historique`.

## Roles

| Role | Mission | Perimetre |
|---|---|---|
| Super administrateur plateforme | Administration technique multi-entreprise | global |
| Direction | KPI, rapports et validations | company |
| Administrateur | Comptes, referentiels et exploitation autorisee | company |
| Responsable commercial / Commercial | Pilotage d'equipe / portefeuille personnel | team / own |
| Comptable / Caissier | Finance / encaissements et recus | company / own |
| Gestionnaire stock / Magasinier | Stock / reception et preparation | company / branch |
| RH / Secretaire / Employe | Dossier RH / accueil / espace personnel | department / own |
| Support / Client / Fournisseur | Portail limite aux dossiers necessaires | own |

Les roles metier dont les modules n'existent pas encore (CRM, agenda, portail client-fournisseur, tickets) sont reserves dans le modele, mais ne sont pas attribuables avant l'implementation de ces modules. Aucun droit implicite ne leur est accorde.

## Matrice appliquee

Les permissions actives sont stockees dans `permissions`, associees a `roles` par `role_permissions`, et peuvent etre surchargees par `utilisateur_permissions`. Elles couvrent produits, stock, ventes, fournisseurs, depenses, employes, paie, rapports, historique, parametres, utilisateurs, notifications et referentiels.

Le super administrateur technique a `super_admin`; les autres roles ne recoivent que les lignes explicites de la matrice. Une surcharge individuelle peut accorder ou refuser une permission precise a un compte non super-administrateur.

## Perimetres et regles de securite

Les niveaux sont `own`, `team`, `department`, `branch`, `company` et `global`. Les controleurs doivent les appliquer a leurs requetes SQL, jamais seulement a l'ecran. `own` est deja impose sur les ventes des vendeuses; chaque nouveau module doit declarer sa colonne de propriete avant son exposition.

- Une URL ou API sans permission renvoie `403`.
- Un compte ou une entreprise desactivee invalide immediatement les JWT existants.
- Les exports sont proteges comme les ecrans qui exposent les memes donnees.
- Suppression, annulation, ajustement de stock, changement de role ou de permission exigent justification, audit et, si le workflow le prevoit, une permission `valider` distincte.
- Les mots de passe et leurs hashes ne figurent jamais dans l'audit.

## Schema

`entreprises 1-n utilisateurs`, `entreprises 1-n roles`, `roles n-n permissions` (avec perimetre) et `utilisateurs n-n permissions` (surcharges accordee/refusee). Chaque table metier doit porter `entreprise_id`; une donnee personnelle doit egalement porter son proprietaire pour rendre `own` verifiable cote SQL.
