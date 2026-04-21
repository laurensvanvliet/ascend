'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Result {
  id: string
  place_name: string
  center: [number, number]
}

interface Props {
  onSelect: (center: [number, number]) => void
  mapboxToken: string
}

export default function SearchBar({ onSelect, mapboxToken }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback((q: string) => {
    if (q.trim().length < 2) { setResults([]); setOpen(false); return }
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxToken}&types=place,locality,neighborhood,address&limit=5`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const items: Result[] = (data.features ?? []).map((f: { id: string; place_name: string; center: [number, number] }) => ({
          id: f.id,
          place_name: f.place_name,
          center: f.center,
        }))
        setResults(items)
        setOpen(items.length > 0)
        setActiveIdx(-1)
      })
      .catch(() => {})
  }, [mapboxToken])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 300)
  }

  function handleSelect(result: Result) {
    setQuery(result.place_name)
    setResults([])
    setOpen(false)
    onSelect(result.center)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx >= 0) handleSelect(results[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  return (
    <div className="fixed top-4 left-4 z-10 w-80">
      <div className="bg-[#111] border border-[#222] rounded-xl overflow-hidden">
        <div className="flex items-center px-4 py-3 gap-3">
          <svg className="w-3.5 h-3.5 text-[#555] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search location…"
            className="flex-1 text-sm text-white placeholder-[#444] outline-none bg-transparent"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setOpen(false); inputRef.current?.focus() }}
              className="text-[#444] hover:text-[#aaa] transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {open && (
          <ul className="border-t border-[#1e1e1e]">
            {results.map((r, i) => (
              <li
                key={r.id}
                onMouseDown={() => handleSelect(r)}
                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                  i === activeIdx ? 'bg-white text-black' : 'text-[#aaa] hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                {r.place_name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
