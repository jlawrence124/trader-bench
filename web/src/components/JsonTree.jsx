import React, { useState } from 'react'

function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function Node({ name, data, level = 0 }) {
  const isArr = Array.isArray(data)
  const isObj = isObject(data)

  if (!isArr && !isObj) {
    let display
    if (typeof data === 'string') display = `"${data}"`
    else if (data === null) display = 'null'
    else display = String(data)
    return (
      <div className="font-mono text-xs title" style={{ marginLeft: level * 12 }}>
        {typeof name !== 'undefined' && <span className="text-slate-500 mr-1">{name}:</span>}
        <span>{display}</span>
      </div>
    )
  }

  const count = isArr ? data.length : Object.keys(data).length
  const [open, setOpen] = useState(level === 0)
  const label = isArr ? `Array(${count})` : `Object(${count})`
  return (
    <div style={{ marginLeft: level * 12 }}>
      <div
        className="font-mono text-xs title flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        {typeof name !== 'undefined' && <span className="text-slate-500">{name}:</span>}
        <span className="muted">{label}</span>
      </div>
      {open && (
        <div className="mt-1">
          {isArr
            ? data.map((v, i) => (
                <Node key={i} name={i} data={v} level={level + 1} />
              ))
            : Object.entries(data).map(([k, v]) => (
                <Node key={k} name={k} data={v} level={level + 1} />
              ))}
        </div>
      )}
    </div>
  )
}

export default function JsonTree({ data }) {
  return (
    <div className="whitespace-pre-wrap break-all overflow-x-auto">
      <Node data={data} />
    </div>
  )
}

