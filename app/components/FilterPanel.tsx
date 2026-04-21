'use client'

import { useRef } from 'react'
import type { Filters, TerrainType, RadiusKm } from '../lib/hillTypes'
import { DEFAULT_FILTERS, RADIUS_OPTIONS } from '../lib/hillTypes'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  scanning: boolean
  hillCount: number | null
  onRescan: () => void
}

const TERRAIN_OPTIONS: { id: TerrainType; label: string }[] = [
  { id: 'road', label: 'Road' },
  { id: 'trail', label: 'Trail' },
  { id: 'path', label: 'Path' },
  { id: 'mixed', label: 'Mixed' },
]

const DIFFICULTY_OPTIONS: { id: Filters['difficulty']; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'easy', label: 'Easy' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'hard', label: 'Hard' },
]

interface SliderProps {
  label: string
  min: number
  max: number
  value: number
  step?: number
  snapValues: number[]
  onChange: (v: number) => void
  format: (v: number) => string
}

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

function Slider({ label, min, max, value, step = 1, snapValues, onChange, format }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  const startXRef = useRef(0)
  const movedPxRef = useRef(0)
  const isDraggingRef = useRef(false)

  // Read ref at render time — drag renders suppress the transition, snap renders apply it
  const FADE = 'opacity 350ms ease, background-color 350ms ease'
  const transition = isDraggingRef.current
    ? FADE
    : `width 300ms ${SPRING}, left 300ms ${SPRING}, ${FADE}`

  function handlePointerDown(e: React.PointerEvent<HTMLInputElement>) {
    startXRef.current = e.clientX
    movedPxRef.current = 0
    isDraggingRef.current = false
  }

  function handlePointerMove(e: React.PointerEvent<HTMLInputElement>) {
    movedPxRef.current = Math.abs(e.clientX - startXRef.current)
    if (movedPxRef.current >= 6) isDraggingRef.current = true
  }

  function handleChange(raw: number) {
    if (isDraggingRef.current) onChange(raw)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLInputElement>) {
    if (!isDraggingRef.current) {
      const rect = e.currentTarget.getBoundingClientRect()
      const rawPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const rawValue = min + rawPct * (max - min)
      const nearest = snapValues.reduce((a, b) =>
        Math.abs(b - rawValue) < Math.abs(a - rawValue) ? b : a
      )
      onChange(nearest)
    }
    isDraggingRef.current = false
    movedPxRef.current = 0
  }

  return (
    <div className="flex gap-2 items-center">
      <div
        className="relative flex-1 h-10 rounded-lg overflow-hidden"
        style={{ background: '#1c1c1c', isolation: 'isolate' }}
      >
        {/* Fixed dots */}
        {snapValues.map((sv) => (
          <div
            key={sv}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-1 rounded-full pointer-events-none"
            style={{ left: `${((sv - min) / (max - min)) * 100}%`, background: '#404040', zIndex: 1 }}
          />
        ))}

        {/* White label under fill — visible on dark background when fill hasn't reached */}
        <div
          className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"
          style={{ zIndex: 1 }}
        >
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-white whitespace-nowrap select-none">
            {label}
          </span>
        </div>

        {/* White fill with black label — clips text where fill exists */}
        <div
          className="absolute inset-y-0 left-0 bg-white flex items-center pl-3 overflow-hidden pointer-events-none"
          style={{ width: `${pct}%`, zIndex: 2, transition, borderRadius: '0 8px 8px 0', opacity: pct === 0 ? 0 : 1 }}
        >
          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-black whitespace-nowrap select-none">
            {label}
          </span>
        </div>

        {/* Handle — inside fill, white when at minimum (no fill to sit in) */}
        <div
          className="absolute top-1.5 bottom-1.5 rounded-full pointer-events-none"
          style={{
            left: `max(3px, calc(${pct}% - 11px))`,
            width: '3px',
            background: pct === 0 ? 'white' : '#111',
            zIndex: 3,
            transition,
          }}
        />

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onChange={e => handleChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ margin: 0, zIndex: 4 }}
        />
      </div>

      <div
        className="flex-shrink-0 h-10 rounded-lg flex items-center justify-center"
        style={{ background: '#1c1c1c', width: '68px' }}
      >
        <span className="text-white font-mono text-sm font-medium">{format(value)}</span>
      </div>
    </div>
  )
}

export default function FilterPanel({ filters, onChange, scanning, hillCount, onRescan }: Props) {
  function reset() {
    onChange({ ...DEFAULT_FILTERS, terrain: new Set(DEFAULT_FILTERS.terrain) })
  }

  function toggleTerrain(id: TerrainType) {
    const next = new Set(filters.terrain)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange({ ...filters, terrain: next })
  }

  return (
    <aside className="fixed right-4 top-4 bottom-4 w-72 bg-[#111] border border-[#222] rounded-xl flex flex-col overflow-hidden z-10">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e1e]">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-white uppercase">Filters</span>
        <button
          onClick={reset}
          className="text-[10px] tracking-[0.1em] uppercase text-[#555] hover:text-white transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Radius */}
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-[#555] mb-2">Radius</p>
          <div className="flex gap-1.5">
            {RADIUS_OPTIONS.map((km) => (
              <button
                key={km}
                onClick={() => onChange({ ...filters, radiusKm: km as RadiusKm })}
                className={`flex-1 py-1.5 text-[11px] font-medium border transition-colors ${
                  filters.radiusKm === km
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-[#666] border-[#2a2a2a] hover:border-[#555]'
                }`}
              >
                {km}km
              </button>
            ))}
          </div>
        </div>

        {/* Incline */}
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-[#555] mb-2">Incline</p>
          <div className="space-y-2">
            <Slider
              label="Min"
              min={0} max={40} value={filters.inclineMin}
              snapValues={[5, 10, 15, 20, 25, 30, 35]}
              onChange={v => onChange({ ...filters, inclineMin: Math.min(v, filters.inclineMax - 1) })}
              format={v => `${v}%`}
            />
            <Slider
              label="Max"
              min={0} max={40} value={filters.inclineMax}
              snapValues={[5, 10, 15, 20, 25, 30, 35]}
              onChange={v => onChange({ ...filters, inclineMax: Math.max(v, filters.inclineMin + 1) })}
              format={v => `${v}%`}
            />
          </div>
        </div>

        {/* Length */}
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-[#555] mb-2">Length</p>
          <div className="space-y-2">
            <Slider
              label="Min"
              min={50} max={2000} step={50} value={filters.lengthMin}
              snapValues={[250, 500, 750, 1000, 1250, 1500, 1750]}
              onChange={v => onChange({ ...filters, lengthMin: Math.min(v, filters.lengthMax - 50) })}
              format={v => v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${v}m`}
            />
            <Slider
              label="Max"
              min={50} max={2000} step={50} value={filters.lengthMax}
              snapValues={[250, 500, 750, 1000, 1250, 1500, 1750]}
              onChange={v => onChange({ ...filters, lengthMax: Math.max(v, filters.lengthMin + 50) })}
              format={v => v >= 1000 ? `${(v / 1000).toFixed(1)}km` : `${v}m`}
            />
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-[#555] mb-2">Difficulty</p>
          <div className="flex flex-wrap gap-1.5">
            {DIFFICULTY_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => onChange({ ...filters, difficulty: id })}
                className={`px-3 py-1.5 text-[11px] font-medium border transition-colors ${
                  filters.difficulty === id
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-[#666] border-[#2a2a2a] hover:border-[#555]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Terrain */}
        <div>
          <p className="text-[10px] tracking-[0.14em] uppercase text-[#555] mb-1">Terrain</p>
          <div>
            {TERRAIN_OPTIONS.map(({ id, label }) => (
              <div key={id} className="flex items-center justify-between py-2.5 border-b border-[#1a1a1a] last:border-0">
                <span className="text-sm text-[#aaa]">{label}</span>
                <button
                  onClick={() => toggleTerrain(id)}
                  className={`relative w-11 h-6 rounded-full focus:outline-none p-0 ${
                    filters.terrain.has(id) ? 'bg-white' : 'bg-[#2a2a2a]'
                  }`}
                  style={{ transition: 'background-color 350ms ease' }}
                  aria-pressed={filters.terrain.has(id)}
                >
                  <span
                    className="absolute top-1 w-4 h-4 rounded-full shadow-sm"
                    style={{
                      left: filters.terrain.has(id) ? '24px' : '4px',
                      background: filters.terrain.has(id) ? '#111' : '#666',
                      transition: 'left 350ms ease, background-color 350ms ease',
                    }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-[#1e1e1e] space-y-2.5">
        {hillCount !== null && !scanning && (
          <p className="text-[10px] tracking-[0.12em] uppercase text-center text-[#555]">
            {hillCount === 0 ? 'No hills found' : `${hillCount} hill${hillCount === 1 ? '' : 's'} found`}
          </p>
        )}
        <button
          onClick={onRescan}
          disabled={scanning}
          className="w-full bg-white hover:bg-gray-100 disabled:bg-[#222] disabled:text-[#555] disabled:cursor-not-allowed text-black text-[11px] font-semibold tracking-[0.16em] uppercase py-3 transition-colors rounded-sm"
        >
          {scanning ? 'Scanning…' : 'Find hills'}
        </button>
      </div>
    </aside>
  )
}
