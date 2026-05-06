'use client'

import { useEffect, useState } from 'react'
import type { Hill } from '../lib/hillTypes'

function bearing(from: [number, number], to: [number, number]): number {
  const φ1 = (from[1] * Math.PI) / 180
  const φ2 = (to[1] * Math.PI) / 180
  const Δλ = ((to[0] - from[0]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

interface Props {
  hill: Hill
}

export default function HillStreetView({ hill }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    setSrc(null)

    const coords = hill.coordinates
    const sampleIndices = [0, Math.floor(coords.length * 0.2), Math.floor(coords.length * 0.4)]
    const seen = new Set<number>()
    const candidates = sampleIndices
      .filter(i => { if (seen.has(i)) return false; seen.add(i); return true })
      .map(i => {
        const from = coords[i]
        const to = coords[Math.min(i + 1, coords.length - 1)]
        const head = Math.round(bearing(from, to))
        return `${from[1]},${from[0]},${head}`
      })
      .join(';')

    setSrc(`/api/streetview?candidates=${encodeURIComponent(candidates)}`)
  }, [hill.id, hill.coordinates])

  return (
    <div className="w-72 bg-[#111] border border-[#222] rounded-xl overflow-hidden">
      {failed ? (
        <div className="w-full flex flex-col items-center justify-center gap-2" style={{ height: 140, background: '#0d0d0d' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-[10px] tracking-[0.12em] uppercase text-[#333]">Street view unavailable</span>
        </div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Street view of hill start"
          className="w-full block"
          style={{ height: 140, objectFit: 'cover' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="w-full bg-[#0d0d0d] animate-pulse" style={{ height: 140 }} />
      )}
      <div className="px-4 py-2.5">
        <span className="text-[10px] tracking-[0.12em] uppercase text-[#444]">Street view · start of hill</span>
      </div>
    </div>
  )
}
