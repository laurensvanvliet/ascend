'use client'

import type { Hill, DifficultyLevel } from '../lib/hillTypes'

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  easy: '#4ade80',
  moderate: '#fb923c',
  hard: '#f87171',
}

interface Props {
  hills: Hill[]
  onRemove: (hillId: string) => void
  onSelect: (hill: Hill) => void
}

export default function SavedHillsPanel({ hills, onRemove, onSelect }: Props) {
  return (
    <div className="w-72 bg-[#111] border border-[#222] rounded-xl overflow-hidden max-h-[70vh] overflow-y-auto">
      <div className="px-4 py-3 border-b border-[#1e1e1e]">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-[#555] uppercase">
          Saved · {hills.length}
        </span>
      </div>

      {hills.length === 0 ? (
        <p className="text-[11px] text-[#444] text-center tracking-[0.1em] uppercase px-4 py-5">
          No saved hills
        </p>
      ) : (
        <ul>
          {hills.map((hill, i) => (
            <li
              key={hill.id}
              onClick={() => onSelect(hill)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1a1a1a] transition-colors group/row ${
                i < hills.length - 1 ? 'border-b border-[#1a1a1a]' : ''
              }`}
            >
              <div
                className="w-1 h-7 rounded-full flex-shrink-0"
                style={{ background: DIFFICULTY_COLORS[hill.difficulty] }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-mono font-bold text-white">{hill.inclinePct}%</span>
                  <span className="text-[11px] text-[#555]">
                    {hill.length >= 1000 ? `${(hill.length / 1000).toFixed(1)}km` : `${hill.length}m`}
                  </span>
                  <span className="text-[11px] text-[#555]">+{hill.elevationGain}m</span>
                </div>
                <p className="text-[10px] tracking-[0.1em] uppercase text-[#444] mt-0.5">
                  {hill.terrain} · {hill.difficulty}
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(hill.id) }}
                className="text-[#333] hover:text-[#f87171] transition-colors flex-shrink-0 opacity-0 group-hover/row:opacity-100"
                aria-label="Remove"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
