const express = require('express');
const path = require('path');
const alpaca = require('./src/alpacaService');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// Simple API endpoints
app.get('/api/account', async (req, res) => {
  try {
    const data = await alpaca.getAccountInfo();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/market/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const data = await alpaca.getMarketData(symbol);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/positions', async (req, res) => {
  try {
    const data = await alpaca.getPositions();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Web server running on http://localhost:${PORT}`);
});
