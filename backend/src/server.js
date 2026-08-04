require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3010;

app.listen(PORT, () => {
  console.log(`MACHIBEL backend en ecoute sur le port ${PORT}`);
});
