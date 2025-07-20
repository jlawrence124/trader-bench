const { useState, useEffect } = React;

function App() {
  const [hasKeys, setHasKeys] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('runs');
  const [selectedLog, setSelectedLog] = useState('');
  const [logContent, setLogContent] = useState('');

  useEffect(() => {
    fetch('/api/env-check')
      .then(res => res.json())
      .then(data => {
        setHasKeys(data.hasKeys);
        if (data.hasKeys) {
          loadRuns();
          loadLogList();
        }
      });
  }, []);

  const loadRuns = () => {
    fetch('/api/runs')
      .then(res => res.json())
      .then(data => setRuns(data));
  };

  const loadLogList = () => {
    fetch('/api/logs')
      .then(res => res.json())
      .then(files => {
        setLogs(files);
        if (files.length) loadLog(files[0]);
      });
  };

  const loadLog = (name) => {
    setSelectedLog(name);
    fetch(`/api/logs/${encodeURIComponent(name)}`)
      .then(res => res.text())
      .then(text => setLogContent(text));
  };

  const saveKeys = () => {
    if (!apiKey || !apiSecret) return alert('Both fields are required');
    fetch('/api/save-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: apiKey, secret: apiSecret })
    }).then(() => {
      setHasKeys(true);
      loadRuns();
      loadLogList();
    });
  };

  if (hasKeys === null) return null;

  if (!hasKeys) {
    return (
      <main className="max-w-md mx-auto py-10 flex flex-col gap-4">
        <h2 className="text-xl font-bold">Enter Alpaca Credentials</h2>
        <input className="border p-2" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
        <input className="border p-2" placeholder="API Secret" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
        <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={saveKeys}>Save</button>
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-6 text-center shadow">
        <h1 className="text-2xl font-bold">AI Trading Dashboard</h1>
      </header>

      <nav className="bg-white shadow flex space-x-4 px-4 py-2">
        <button className={`px-3 py-1 rounded ${activeTab==='runs'?'bg-blue-500 text-white':'bg-gray-100'}`} onClick={() => setActiveTab('runs')}>Recent Runs</button>
        <button className={`px-3 py-1 rounded ${activeTab==='logs'?'bg-blue-500 text-white':'bg-gray-100'}`} onClick={() => setActiveTab('logs')}>Logs</button>
        <button className="px-3 py-1 rounded bg-gray-200" disabled>Leaderboard (Coming Soon)</button>
      </nav>

      {activeTab === 'runs' && (
        <section className="p-4 flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 text-left">Model</th>
                <th className="p-2 text-left">Start</th>
                <th className="p-2 text-left">End</th>
                <th className="p-2 text-left">S&amp;P Gain ($)</th>
                <th className="p-2 text-left">Portfolio Gain ($)</th>
                <th className="p-2 text-left">Diff (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {runs.map((r,i) => {
                const diff = r.spyGain !== 0 ? ((r.portfolioGain - r.spyGain) / Math.abs(r.spyGain)) * 100 : 0;
                return (
                  <tr key={i} className="hover:bg-indigo-50">
                    <td className="p-2">{r.model}</td>
                    <td className="p-2">{r.startDate || r.date}</td>
                    <td className="p-2">{r.endDate || r.date}</td>
                    <td className="p-2">${r.spyGain.toFixed(2)}</td>
                    <td className="p-2">${r.portfolioGain.toFixed(2)}</td>
                    <td className="p-2">{diff.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'logs' && (
        <section className="p-4 space-y-4 flex-1 overflow-auto">
          <select className="border p-2" value={selectedLog} onChange={e => loadLog(e.target.value)}>
            {logs.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <pre className="bg-gray-100 p-4 rounded h-96 overflow-auto whitespace-pre-wrap">{logContent}</pre>
        </section>
      )}

      {activeTab === 'leaderboard' && (
        <section className="p-4 flex-1">Leaderboard under construction...</section>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
