const { useState, useEffect } = React;

const formatDateTime = (val) => {
  if (!val) return '';
  const dt = new Date(val);
  if (isNaN(dt)) return val;
  return dt.toLocaleString();
};

function App() {
  const [hasKeys, setHasKeys] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [runs, setRuns] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('runs');
  const [selectedLog, setSelectedLog] = useState('');
  const [logContent, setLogContent] = useState('');
  const [benchmarkLog, setBenchmarkLog] = useState('');
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);

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

  useEffect(() => {
    if (activeTab === 'benchmark') {
      loadBenchmarkLog();
      loadAccount();
      loadPositions();
      const id = setInterval(loadBenchmarkLog, 5000);
      return () => clearInterval(id);
    }
  }, [activeTab]);

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

  const startBenchmark = () => {
    fetch('/api/start-benchmark', { method: 'POST' })
      .then(() => loadBenchmarkLog());
  };

  const loadBenchmarkLog = () => {
    fetch('/api/run-log')
      .then(res => res.text())
      .then(text => setBenchmarkLog(text));
  };

  const loadAccount = () => {
    fetch('/api/account')
      .then(res => res.json())
      .then(data => setAccount(data));
  };

  const loadPositions = () => {
    fetch('/api/positions')
      .then(res => res.json())
      .then(data => setPositions(data));
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
      <main className="max-w-md mx-auto py-10 flex flex-col space-y-4 text-gray-900 dark:text-gray-100">
        <h2 className="text-xl font-bold">Enter Alpaca Credentials</h2>
        <input className="border rounded-md p-2 focus:outline-none focus:ring dark:border-gray-700 dark:bg-gray-800" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
        <input className="border rounded-md p-2 focus:outline-none focus:ring dark:border-gray-700 dark:bg-gray-800" placeholder="API Secret" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
        <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md" onClick={saveKeys}>Save</button>
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900">
      <header className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-6 text-center shadow-lg">
        <h1 className="text-2xl font-bold">AI Trading Dashboard</h1>
      </header>

      <nav className="bg-gray-100 dark:bg-gray-800 shadow flex flex-wrap gap-2 sm:gap-4 px-4 py-2 justify-center sm:justify-start">
        <button className={`px-3 py-1 rounded ${activeTab==='runs'?'bg-blue-500 text-white':'bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`} onClick={() => setActiveTab('runs')}>Recent Runs</button>
        <button className={`px-3 py-1 rounded ${activeTab==='logs'?'bg-blue-500 text-white':'bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`} onClick={() => setActiveTab('logs')}>Logs</button>
        <button className={`px-3 py-1 rounded ${activeTab==='benchmark'?'bg-blue-500 text-white':'bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`} onClick={() => setActiveTab('benchmark')}>Benchmark</button>
        <button className="px-3 py-1 rounded bg-gray-300 dark:bg-gray-700 text-gray-500" disabled>Leaderboard (Coming Soon)</button>
      </nav>

      {activeTab === 'runs' && (
        <section className="p-4 flex-1 overflow-auto">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-300 dark:divide-gray-700">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 text-xs sm:text-sm">
                <th className="p-2 text-left">Model</th>
                <th className="p-2 text-left">Start</th>
                <th className="p-2 text-left">First Trade</th>
                <th className="p-2 text-left">End</th>
                <th className="p-2 text-left">S&amp;P Gain ($)</th>
                <th className="p-2 text-left">Portfolio Gain ($)</th>
                <th className="p-2 text-left">Diff (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {runs.map((r,i) => {
                const diff = r.spyGain !== 0 ? ((r.portfolioGain - r.spyGain) / Math.abs(r.spyGain)) * 100 : 0;
                return (
                  <tr key={i} className="hover:bg-indigo-50 dark:hover:bg-indigo-900">
                    <td className="p-2">{r.model}</td>
                    <td className="p-2">{formatDateTime(r.startDate || r.date)}</td>
                    <td className="p-2">{formatDateTime(r.firstTradeDate)}</td>
                    <td className="p-2">{formatDateTime(r.endDate || r.date)}</td>
                    <td className="p-2">${r.spyGain.toFixed(2)}</td>
                    <td className="p-2">${r.portfolioGain.toFixed(2)}</td>
                    <td className="p-2">{diff.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {activeTab === 'logs' && (
        <section className="p-4 space-y-4 flex-1 overflow-auto">
          <select className="border rounded-md p-2 dark:border-gray-700 dark:bg-gray-800" value={selectedLog} onChange={e => loadLog(e.target.value)}>
            {logs.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md h-96 overflow-auto whitespace-pre-wrap">{logContent}</pre>
        </section>
      )}

      {activeTab === 'benchmark' && (
        <section className="p-4 space-y-4 flex-1 overflow-auto">
          <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md" onClick={startBenchmark}>Start Benchmark</button>
          <div>
            <h3 className="font-bold mb-1">Account</h3>
            {account && (
              <p>Equity: ${parseFloat(account.equity).toFixed(2)}</p>
            )}
          </div>
          <div>
            <h3 className="font-bold mb-1">Positions</h3>
            <table className="min-w-full text-sm divide-y divide-gray-300 dark:divide-gray-700">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800">
                  <th className="p-1 text-left">Symbol</th>
                  <th className="p-1 text-left">Qty</th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol}>
                    <td className="p-1">{p.symbol}</td>
                    <td className="p-1">{p.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-bold mb-1">Running Log</h3>
            <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md h-60 overflow-auto whitespace-pre-wrap">{benchmarkLog}</pre>
          </div>
        </section>
      )}

      {activeTab === 'leaderboard' && (
        <section className="p-4 flex-1">Leaderboard under construction...</section>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
