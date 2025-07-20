async function loadAccountInfo() {
    try {
        const res = await fetch('/api/account');
        const data = await res.json();
        document.getElementById('account-info').textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        document.getElementById('account-info').textContent = 'Failed to load account info.';
        console.error(err);
    }
}

async function loadMarketData() {
    const symbol = document.getElementById('symbol').value.trim();
    if (!symbol) return;
    try {
        const res = await fetch(`/api/market/${symbol}`);
        const data = await res.json();
        document.getElementById('market-data').textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        document.getElementById('market-data').textContent = 'Failed to load market data.';
        console.error(err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadAccountInfo();
});
