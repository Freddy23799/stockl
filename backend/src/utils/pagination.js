// Pagination uniforme pour les listes qui peuvent grossir sur plusieurs
// annees d'usage (ventes, historique, mouvements de stock). page=1-based.
function getPagination(req, { defaultSize = 50, maxSize = 200 } = {}) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number(req.query.pageSize) || defaultSize));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

module.exports = { getPagination };
