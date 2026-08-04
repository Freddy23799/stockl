# MACHIBEL - Systeme de gestion pour parfumerie

Voir [docs/PROJET_PARFUMERIE_BRIEF.md](docs/PROJET_PARFUMERIE_BRIEF.md) pour le brief complet.

## Structure

- `backend/` - API Node.js/Express
- `frontend/` - PWA Vue.js
- `docker-compose.yml` - PostgreSQL **dev uniquement**

## Dev local

```bash
# 1. Demarrer PostgreSQL (dev uniquement, jamais utilise en production)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run migrate                                  # cree/actualise le schema
npm run seed:admin -- admin@machibel.local motdepasse  # premier compte admin (une seule fois)
npm run dev        # http://localhost:3010

# 3. Frontend
cd frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:5174
```

## Ports reserves pour ce projet (dev)

Cette machine de dev fait tourner plusieurs projets en parallele. Ports verifies
libres et retenus pour MACHIBEL :

| Service              | Port |
|----------------------|------|
| PostgreSQL (Docker)  | 5439 |
| Backend Express      | 3010 |
| Frontend Vite (dev)  | 5174 |

## Important : Docker = dev uniquement

En **production**, chez le client :
- PostgreSQL tourne **nativement** sur la machine Windows (pas de conteneur)
- Le backend tourne comme **service Windows** (NSSM / node-windows)
- Le frontend est une **PWA installable** sur le bureau

Le conteneur `parfumerie-machibel-postgres-dev` (voir `docker-compose.yml`) ne
sert qu'a simuler ce PostgreSQL natif pendant le developpement sur cette
machine Ubuntu, qui n'a pas Postgres installe en dur et qui heberge d'autres
projets en parallele. Le code applicatif n'a aucune dependance a Docker.
