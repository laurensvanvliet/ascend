'use client'

import { useEffect, useState } from 'react'
import type { Hill, DifficultyLevel } from '../lib/hillTypes'

interface Props {
  hill: Hill
  onClose: () => void
  isSaved: boolean
  onToggleSave: () => void
}

const TERRAIN_LABELS: Record<string, string> = {
  road: 'Road',
  trail: 'Trail',
  path: 'Path',
  mixed: 'Mixed',
}

const DIFFICULTY_COLORS: Record<DifficultyLevel, string> = {
  easy: '#4ade80',
  moderate: '#fb923c',
  hard: '#f87171',
}

function HillSilhouette({ profile, difficulty }: { profile: Hill['elevationProfile']; difficulty: DifficultyLevel }) {
  if (profile.length < 2) return null

  const W = 288
  const H = 120
  const PAD_TOP = 20
  const PAD_BOTTOM = 12

  const maxDist = profile[profile.length - 1].distance
  const elevs = profile.map(p => p.elevation)
  const minElev = Math.min(...elevs)
  const maxElev = Math.max(...elevs)
  const elevRange = maxElev - minElev || 1

  const toX = (d: number) => (d / maxDist) * W
  const toY = (e: number) => H - PAD_BOTTOM - ((e - minElev) / elevRange) * (H - PAD_TOP - PAD_BOTTOM)

  const polyPoints = [
    `0,${H}`,
    ...profile.map(p => `${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`),
    `${W},${H}`,
  ].join(' ')

  const strokePoints = profile
    .map(p => `${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`)
    .join(' ')

  const color = DIFFICULTY_COLORS[difficulty]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0a0a" />
          <stop offset="100%" stopColor="#161616" />
        </linearGradient>
        <linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.04} />
        </linearGradient>
      </defs>

      <rect width={W} height={H} fill="url(#bgGrad)" />

      {[0.25, 0.5, 0.75].map(t => {
        const y = PAD_TOP + t * (H - PAD_TOP - PAD_BOTTOM)
        return <line key={t} x1={0} y1={y} x2={W} y2={y} stroke="white" strokeOpacity={0.05} strokeWidth={1} />
      })}

      <polygon points={polyPoints} fill="url(#fillGrad)" />
      <polyline points={strokePoints} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />

      {(() => {
        const peakIdx = elevs.indexOf(maxElev)
        const px = toX(profile[peakIdx].distance)
        const py = toY(maxElev)
        return <circle cx={px} cy={py} r={3} fill={color} />
      })()}
    </svg>
  )
}

export default function HillDetailCard({ hill, onClose, isSaved, onToggleSave }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(t)
  }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 250)
  }

  return (
    <aside
      className={`fixed left-4 bottom-4 w-72 bg-[#111] border border-[#222] rounded-xl z-20 transition-all duration-250 ease-out overflow-hidden ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <HillSilhouette profile={hill.elevationProfile} difficulty={hill.difficulty} />

      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1e1e1e]">
        <span className="text-[10px] font-semibold tracking-[0.16em] text-white uppercase">Hill</span>
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSave}
            className={`transition-colors ${isSaved ? 'text-white' : 'text-[#555] hover:text-white'}`}
            aria-label={isSaved ? 'Unsave hill' : 'Save hill'}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2h10a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
            </svg>
          </button>
          <button
            onClick={handleClose}
            className="text-[#555] hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="flex gap-6 mb-4">
          <div>
            <p className="text-2xl font-mono font-bold text-white leading-none">{hill.inclinePct}%</p>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#555] mt-1.5">Incline</p>
          </div>
          <div>
            <p className="text-2xl font-mono font-bold text-white leading-none">
              {hill.length >= 1000 ? `${(hill.length / 1000).toFixed(1)}km` : `${hill.length}m`}
            </p>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#555] mt-1.5">Length</p>
          </div>
          <div>
            <p className="text-2xl font-mono font-bold text-white leading-none">+{hill.elevationGain}m</p>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[#555] mt-1.5">Gain</p>
          </div>
        </div>

        <div className="flex gap-2">
          <span className="text-[10px] tracking-[0.1em] uppercase border border-[#2a2a2a] px-2.5 py-1 text-[#666]">
            {TERRAIN_LABELS[hill.terrain] ?? hill.terrain}
          </span>
          <span
            className="text-[10px] tracking-[0.1em] uppercase px-2.5 py-1"
            style={{ border: `1px solid ${DIFFICULTY_COLORS[hill.difficulty]}40`, color: DIFFICULTY_COLORS[hill.difficulty] }}
          >
            {hill.difficulty}
          </span>
        </div>
      </div>
    </aside>
  )
}
