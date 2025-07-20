async function checkKeys() {
  const res = await fetch('/api/env-check');
  const data = await res.json();
  if (data.hasKeys) {
    showDashboard();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
  }
}

async function saveKeys() {
  const key = document.getElementById('api-key').value.trim();
  const secret = document.getElementById('api-secret').value.trim();
  if (!key || !secret) return alert('Both fields are required');
  await fetch('/api/save-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, secret })
  });
  document.getElementById('setup-screen').classList.add('hidden');
  showDashboard();
}

function showDashboard() {
  document.getElementById('dashboard').classList.remove('hidden');
  loadRuns();
  loadLogList();
}

async function loadRuns() {
  const res = await fetch('/api/runs');
  const runs = await res.json();
  const tbody = document.querySelector('#runs-table tbody');
  tbody.innerHTML = '';
  runs.forEach(r => {
    const diff = r.spyGain !== 0 ? ((r.portfolioGain - r.spyGain) / Math.abs(r.spyGain)) * 100 : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.model}</td><td>${r.date}</td><td>$${r.spyGain.toFixed(2)}</td><td>$${r.portfolioGain.toFixed(2)}</td><td>${diff.toFixed(2)}%</td>`;
    tbody.appendChild(tr);
  });
}

async function loadLogList() {
  const res = await fetch('/api/logs');
  const files = await res.json();
  const select = document.getElementById('log-select');
  select.innerHTML = '';
  files.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    select.appendChild(opt);
  });
  if (files.length) loadLog(files[0]);
}

async function loadLog(name) {
  const res = await fetch(`/api/logs/${encodeURIComponent(name)}`);
  const text = await res.text();
  document.getElementById('log-content').textContent = text;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-keys').addEventListener('click', saveKeys);
  document.getElementById('log-select').addEventListener('change', e => loadLog(e.target.value));

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.target).classList.remove('hidden');
    });
  });

  checkKeys();
});
