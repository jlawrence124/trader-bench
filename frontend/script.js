const { useState, useEffect, useRef } = React;

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
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [envVars, setEnvVars] = useState([]);
  const [showSecret, setShowSecret] = useState({});
  const [editing, setEditing] = useState({});
  const [editVals, setEditVals] = useState({});
  const [runActive, setRunActive] = useState(false);
  const [overrideEdit, setOverrideEdit] = useState(false);
  const [missingVars, setMissingVars] = useState([]);
  const [missingInputs, setMissingInputs] = useState({});
  const logRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState('');

  const infoMap = {
    MCP_PORT: 'Port for the HTTP MCP server (e.g., 4000)',
    AGENT_CMD: 'CLI command for your agent (gemini, codex, claude, opencode or other)',
    MCP_SERVER_URL: 'RPC URL used by the agent (e.g., http://localhost:4000/rpc)',
    MODEL_NAME: 'Name used to label each run',
    APCA_API_KEY: 'Your Alpaca API key',
    APCA_API_SECRET: 'Your Alpaca API secret'
  };

  useEffect(() => {
    fetch('/api/env-check')
      .then(res => res.json())
      .then(data => {
        setHasKeys(data.hasKeys);
        setMissingVars(data.missing || []);
        if (data.hasKeys) {
          loadRuns();
          loadLogList();
        }
      });
  }, []);

  const loadRunStatus = () => {
    fetch('/api/run-status')
      .then(res => res.json())
      .then(data => setRunActive(Boolean(data.running)));
  };

  const loadEnvVars = () => {
    fetch('/api/env-vars')
      .then(res => res.json())
      .then(data => setEnvVars(data));
  };

  useEffect(() => {
    if (activeTab === 'benchmark') {
      loadBenchmarkLog();
      const id = setInterval(() => {
        loadBenchmarkLog();
        loadRunStatus();
      }, 5000);
      return () => clearInterval(id);
    }
    if (activeTab === 'positions') {
      loadAccount();
      loadPositions();
      const id = setInterval(() => {
        loadAccount();
        loadPositions();
      }, 5000);
      return () => clearInterval(id);
    }
    if (activeTab === 'debug') {
      loadRunStatus();
      loadEnvVars();
      const id = setInterval(() => {
        loadRunStatus();
        loadEnvVars();
      }, 5000);
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
      .then(() => {
        setRunActive(true);
        loadBenchmarkLog();
      });
  };

  const loadBenchmarkLog = () => {
    fetch('/api/run-log')
      .then(res => res.text())
      .then(text => setBenchmarkLog(text));
  };

  const clearBenchmarkLog = () => setBenchmarkLog('');

  const loadAccount = () => {
    fetch('/api/account')
      .then(res => res.json())
      .then(data => setAccount(data));
  };

  const testAlpaca = () => {
    setConnectionStatus('Testing...');
    fetch('/api/test-alpaca')
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw data;
        setConnectionStatus('Connection successful');
      })
      .catch(err => {
        const msg = err && err.error ? err.error : err.message || 'Error';
        setConnectionStatus(`Connection failed: ${msg}`);
      });
  };

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [benchmarkLog]);

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

  const clearLogContent = () => setLogContent('');

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

  const saveEnvVar = (name) => {
    fetch('/api/set-env-var', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value: editVals[name], override: overrideEdit })
    }).then(() => {
      setEditing(e => ({ ...e, [name]: false }));
      loadEnvVars();
    });
  };

  const clearEnvVar = (name) => {
    fetch('/api/set-env-var', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value: '', override: overrideEdit })
    }).then(() => {
      loadEnvVars();
    });
  };

  if (hasKeys === null) return null;

  if (!hasKeys) {
    const saveVar = (name) => {
      const postVar = (value) => {
        fetch('/api/set-env-var', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, value })
        }).then(() => {
          setMissingVars(v => {
            const updated = v.filter(x => x !== name);
            if (updated.length === 0) {
              setHasKeys(true);
              loadRuns();
              loadLogList();
              loadRunStatus();
            }
            return updated;
          });
        });
      };

      if (name === 'AGENT_CMD') {
        const cmd = missingInputs.AGENT_CMD === 'other' ? missingInputs.AGENT_CMD_OTHER : missingInputs.AGENT_CMD;
        if (!cmd) return;
        postVar(cmd);
        return;
      }
      if (!missingInputs[name]) return;
      postVar(missingInputs[name]);
    };

    return (
      <main className="max-w-md mx-auto py-10 flex flex-col space-y-4 text-gray-900 dark:text-gray-100">
        <h2 className="text-xl font-bold">Missing Environment Variables</h2>
        {missingVars.length > 0 && (
          <p className="text-sm">Missing: {missingVars.join(', ')}</p>
        )}
        {missingVars.includes('APCA_API_KEY') && (
          <div className="flex items-center space-x-2">
            <input className="border rounded-md p-2 flex-1 dark:border-gray-700 dark:bg-gray-800" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <div className="relative group">
              <span className="cursor-pointer">ℹ️</span>
              <span className="absolute hidden group-hover:block bg-gray-700 text-white text-xs rounded p-1 -left-1/2 mt-2 whitespace-nowrap z-10">{infoMap.APCA_API_KEY}</span>
            </div>
          </div>
        )}
        {missingVars.includes('APCA_API_SECRET') && (
          <div className="flex items-center space-x-2">
            <input className="border rounded-md p-2 flex-1 dark:border-gray-700 dark:bg-gray-800" placeholder="API Secret" value={apiSecret} onChange={e => setApiSecret(e.target.value)} />
            <div className="relative group">
              <span className="cursor-pointer">ℹ️</span>
              <span className="absolute hidden group-hover:block bg-gray-700 text-white text-xs rounded p-1 -left-1/2 mt-2 whitespace-nowrap z-10">{infoMap.APCA_API_SECRET}</span>
            </div>
          </div>
        )}
        {missingVars.filter(v => !['APCA_API_KEY','APCA_API_SECRET'].includes(v)).map(name => (
          <div key={name} className="flex items-center space-x-2">
            {name === 'AGENT_CMD' ? (
              <>
                <select
                  className="border rounded-md p-2 flex-1 dark:border-gray-700 dark:bg-gray-800"
                  value={missingInputs.AGENT_CMD || ''}
                  onChange={e => setMissingInputs(m => ({ ...m, AGENT_CMD: e.target.value }))}
                >
                  <option value="">Select CLI</option>
                  <option value="gemini">gemini</option>
                  <option value="codex">codex</option>
                  <option value="claude">claude</option>
                  <option value="opencode">opencode</option>
                  <option value="other">Other...</option>
                </select>
                {missingInputs.AGENT_CMD === 'other' && (
                  <input
                    className="border rounded-md p-2 flex-1 dark:border-gray-700 dark:bg-gray-800"
                    placeholder="Custom command"
                    value={missingInputs.AGENT_CMD_OTHER || ''}
                    onChange={e => setMissingInputs(m => ({ ...m, AGENT_CMD_OTHER: e.target.value }))}
                  />
                )}
              </>
            ) : (
              <input
                className="border rounded-md p-2 flex-1 dark:border-gray-700 dark:bg-gray-800"
                placeholder={name}
                value={missingInputs[name] || ''}
                onChange={e => setMissingInputs(m => ({ ...m, [name]: e.target.value }))}
              />
            )}
            <div className="relative group">
              <span className="cursor-pointer">ℹ️</span>
              <span className="absolute hidden group-hover:block bg-gray-700 text-white text-xs rounded p-1 -left-1/2 mt-2 whitespace-nowrap z-10">{infoMap[name]}</span>
            </div>
            <button className="text-green-600" onClick={() => saveVar(name)}>Save</button>
          </div>
        ))}
        <button
          className="self-start underline text-sm"
          onClick={() => {
            setHasKeys(true);
            loadRuns();
            loadLogList();
            loadRunStatus();
          }}
        >
          Continue anyway
        </button>
        {(missingVars.includes('APCA_API_KEY') || missingVars.includes('APCA_API_SECRET')) && (
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md" onClick={saveKeys}>Save Alpaca Keys</button>
        )}
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
        <button className={`px-3 py-1 rounded ${activeTab==='positions'?'bg-blue-500 text-white':'bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`} onClick={() => setActiveTab('positions')}>Positions</button>
        <button className={`px-3 py-1 rounded ${activeTab==='debug'?'bg-blue-500 text-white':'bg-gray-200 dark:bg-gray-700 dark:text-gray-200'}`} onClick={() => setActiveTab('debug')}>Debug</button>
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
          <button className="ml-2 px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded" onClick={clearLogContent}>Clear</button>
          <pre className="bg-gray-100 dark:bg-gray-800 p-4 rounded-md h-96 overflow-auto whitespace-pre-wrap">{logContent}</pre>
        </section>
      )}

      {activeTab === 'benchmark' && (
        <section className="p-4 space-y-4 flex-1 overflow-auto">
          <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md" onClick={startBenchmark}>Start Benchmark</button>
          <button className="ml-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md" onClick={testAlpaca}>Test Alpaca Connection</button>
          {connectionStatus && (
            <p className="text-sm">{connectionStatus}</p>
          )}
          <div>
            <h3 className="font-bold mb-1">Running Log</h3>
            <button className="mb-1 px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded" onClick={clearBenchmarkLog}>Clear</button>
            <pre ref={logRef} className="bg-gray-100 dark:bg-gray-800 p-2 rounded-md h-60 overflow-auto whitespace-pre-wrap">{benchmarkLog}</pre>
          </div>
        </section>
      )}

      {activeTab === 'positions' && (
        <section className="p-4 space-y-4 flex-1 overflow-auto">
          {selectedPosition ? (
            <div>
              <button className="mb-2 underline" onClick={() => setSelectedPosition(null)}>Back</button>
              <h3 className="font-bold mb-1">{selectedPosition.symbol}</h3>
              <p>Quantity: {selectedPosition.qty}</p>
              {'avg_entry_price' in selectedPosition && (
                <p>Avg Entry Price: ${parseFloat(selectedPosition.avg_entry_price).toFixed(2)}</p>
              )}
              {'current_price' in selectedPosition && (
                <p>Current Price: ${parseFloat(selectedPosition.current_price).toFixed(2)}</p>
              )}
              {'unrealized_pl' in selectedPosition && (
                <p>PNL: ${parseFloat(selectedPosition.unrealized_pl).toFixed(2)}</p>
              )}
              {'avg_entry_time' in selectedPosition && (
                <p>Entry Time: {formatDateTime(selectedPosition.avg_entry_time)}</p>
              )}
            </div>
          ) : (
            <>
              <div>
                <h3 className="font-bold mb-1">Account</h3>
                {account && (
                  <p>Equity: ${parseFloat(account.equity).toFixed(2)}</p>
                )}
              </div>
              <div>
                <h3 className="font-bold mb-1">Positions</h3>
                <p>Total PNL: ${positions.reduce((a,p)=>a+parseFloat(p.unrealized_pl||0),0).toFixed(2)}</p>
                <table className="min-w-full text-sm divide-y divide-gray-300 dark:divide-gray-700">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-800">
                      <th className="p-1 text-left">Symbol</th>
                      <th className="p-1 text-left">Qty</th>
                      <th className="p-1 text-left">PNL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.symbol} className="hover:bg-indigo-50 dark:hover:bg-indigo-900 cursor-pointer" onClick={() => setSelectedPosition(p)}>
                        <td className="p-1">{p.symbol}</td>
                        <td className="p-1">{p.qty}</td>
                        <td className="p-1">${parseFloat(p.unrealized_pl||0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'debug' && (
        <section className="p-4 flex-1 overflow-auto space-y-2">
          <label className="inline-flex items-center">
            <input type="checkbox" className="mr-2" checked={overrideEdit} onChange={e => setOverrideEdit(e.target.checked)} />
            Allow editing while run is active
          </label>
          <table className="min-w-full text-sm divide-y divide-gray-300 dark:divide-gray-700">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800">
                <th className="p-2 text-left">Variable</th>
                <th className="p-2 text-left">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {envVars.map(v => (
                <tr key={v.name}>
                  <td className="p-2 font-mono">{v.name}</td>
                  <td className="p-2">
                    {editing[v.name] ? (
                      <>
                        <input
                          className="border rounded p-1 mr-1 dark:border-gray-700 dark:bg-gray-800"
                          value={editVals[v.name] ?? v.value}
                          onChange={e => setEditVals({ ...editVals, [v.name]: e.target.value })}
                        />
                        <button className="text-green-600 mr-1" onClick={() => saveEnvVar(v.name)}>Save</button>
                        <button className="text-gray-600" onClick={() => setEditing(e => ({ ...e, [v.name]: false }))}>Cancel</button>
                      </>
                    ) : (
                      <>
                        {v.secret && !showSecret[v.name] ? '••••••' : (v.value || '(not set)')}
                        {v.secret && (
                          <button className="ml-2 text-blue-600" onClick={() => setShowSecret(s => ({ ...s, [v.name]: !s[v.name] }))}>
                            {showSecret[v.name] ? 'Hide' : 'Show'}
                          </button>
                        )}
                        {(!runActive || overrideEdit) && (
                          <>
                            <button className="ml-2 text-sm" onClick={() => setEditing(e => ({ ...e, [v.name]: true }))}>✏️</button>
                            <button className="ml-2 text-sm" onClick={() => clearEnvVar(v.name)}>Clear</button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === 'leaderboard' && (
        <section className="p-4 flex-1">Leaderboard under construction...</section>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
