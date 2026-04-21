'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import FilterPanel from './FilterPanel'
import HillDetailCard from './HillDetailCard'
import SavedHillsPanel from './SavedHillsPanel'
import SearchBar from './SearchBar'
import { detectHills } from '../lib/hillDetection'
import type { Hill, Filters } from '../lib/hillTypes'
import { DEFAULT_FILTERS } from '../lib/hillTypes'

const FALLBACK_CENTER: [number, number] = [4.9041, 52.3676]
const USER_ZOOM = 13

const DIFFICULTY_COLORS = {
  easy: '#4ade80',
  moderate: '#fb923c',
  hard: '#f87171',
}

function detectionZoomForRadius(radiusKm: number): number {
  if (radiusKm <= 2) return 13
  if (radiusKm <= 10) return 12
  return 11
}

function stepMetersForRadius(radiusKm: number): number {
  if (radiusKm <= 2) return 20
  return 40
}

function isHillVisible(hill: Hill, filters: Filters): boolean {
  if (hill.inclinePct < filters.inclineMin || hill.inclinePct > filters.inclineMax) return false
  if (hill.length < filters.lengthMin || hill.length > filters.lengthMax) return false
  if (filters.difficulty !== 'any' && hill.difficulty !== filters.difficulty) return false
  if (!filters.terrain.has(hill.terrain)) return false
  return true
}

function createHillMarkerEl(hill: Hill, onClick: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'hill-marker'
  el.style.background = DIFFICULTY_COLORS[hill.difficulty]
  // Mountain peak icon
  el.innerHTML = `<svg viewBox="0 0 12 10" width="9" height="9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,9 6,1 11,9"/></svg>`
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return el
}

function createUserLocationEl(): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'user-location-marker'
  const pulse = document.createElement('div')
  pulse.className = 'user-location-pulse'
  const dot = document.createElement('div')
  dot.className = 'user-location-dot'
  wrapper.appendChild(pulse)
  wrapper.appendChild(dot)
  return wrapper
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const hillsRef = useRef<Hill[]>([])
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  const userLocationRef = useRef<[number, number] | null>(null)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const cancelDetectionRef = useRef<() => void>(() => {})
  const filtersRef = useRef<Filters>(DEFAULT_FILTERS)
  const [mapReady, setMapReady] = useState(false)

  const [hills, setHills] = useState<Hill[]>([])
  const [selectedHill, setSelectedHill] = useState<Hill | null>(null)
  const [scanning, setScanning] = useState(false)
  const [hillCount, setHillCount] = useState<number | null>(null)
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    terrain: new Set(DEFAULT_FILTERS.terrain),
  }))
  const [savedHills, setSavedHills] = useState<Hill[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem('saved-hills')
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })
  const [showSavedPanel, setShowSavedPanel] = useState(false)

  useEffect(() => { filtersRef.current = filters }, [filters])
  useEffect(() => { hillsRef.current = hills }, [hills])
  useEffect(() => {
    localStorage.setItem('saved-hills', JSON.stringify(savedHills))
  }, [savedHills])

  const handleToggleSave = useCallback((hill: Hill) => {
    setSavedHills(prev =>
      prev.some(h => h.id === hill.id) ? prev.filter(h => h.id !== hill.id) : [...prev, hill]
    )
  }, [])

  const handleSelectSavedHill = useCallback((hill: Hill) => {
    setSelectedHill(hill)
    setShowSavedPanel(false)
    mapRef.current?.flyTo({ center: hill.center, zoom: 16, duration: 600 })
  }, [])

  const runDetection = useCallback((center: [number, number], radiusKm: number) => {
    const map = mapRef.current
    if (!map) return

    cancelDetectionRef.current()
    let cancelled = false
    cancelDetectionRef.current = () => { cancelled = true }

    setScanning(true)
    const detZoom = detectionZoomForRadius(radiusKm)

    map.once('idle', () => {
      if (cancelled) return
      const step = stepMetersForRadius(radiusKm)
      const found = detectHills(map, center[0], center[1], radiusKm * 1000, step)
      setHills(found)
      setHillCount(found.length)
      setScanning(false)
      if (map.getZoom() < USER_ZOOM) {
        map.flyTo({ center, zoom: USER_ZOOM, duration: 1000 })
      }
    })

    map.flyTo({ center, zoom: detZoom, duration: 700 })
  }, [])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: FALLBACK_CENTER,
      zoom: USER_ZOOM,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-left')

    map.on('load', () => {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1 })

      // GeoJSON source for hill segments
      map.addSource('hills', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Wide outer glow for selected hill
      map.addLayer({
        id: 'hill-selected-glow',
        type: 'line',
        source: 'hills',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 16,
          'line-opacity': 0.18,
          'line-blur': 8,
        },
      })

      // All hill segments (base)
      map.addLayer({
        id: 'hill-lines',
        type: 'line',
        source: 'hills',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.75,
        },
      })

      // Selected hill on top (brighter + thicker)
      map.addLayer({
        id: 'hill-selected',
        type: 'line',
        source: 'hills',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 1,
        },
      })

      map.on('click', 'hill-lines', (e) => {
        const feature = e.features?.[0]
        if (!feature) return
        const hillId = feature.properties?.id as string
        const hill = hillsRef.current.find(h => h.id === hillId)
        if (hill) {
          setSelectedHill(hill)
          mapRef.current?.flyTo({ center: hill.center, zoom: 16, duration: 600 })
        }
      })

      map.on('mouseenter', 'hill-lines', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'hill-lines', () => { map.getCanvas().style.cursor = '' })

      setMapReady(true)

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          const center: [number, number] = [coords.longitude, coords.latitude]
          userLocationRef.current = center

          const el = createUserLocationEl()
          userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat(center)
            .addTo(map)

          runDetection(center, filtersRef.current.radiusKm)
        },
        () => {
          userLocationRef.current = FALLBACK_CENTER
          runDetection(FALLBACK_CENTER, filtersRef.current.radiusKm)
        },
        { timeout: 8000 }
      )
    })

    return () => {
      cancelDetectionRef.current()
      userMarkerRef.current?.remove()
      markersRef.current.forEach(m => m.remove())
      markersRef.current.clear()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [runDetection])

  // Re-run detection when radius changes (skip first render — map not ready yet)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const loc = userLocationRef.current
    if (!loc) return
    runDetection(loc, filters.radiusKm)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.radiusKm])

  const handleSearchSelect = useCallback((center: [number, number]) => {
    const map = mapRef.current
    if (!map) return
    userLocationRef.current = center

    userMarkerRef.current?.remove()
    const el = createUserLocationEl()
    userMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat(center)
      .addTo(map)

    runDetection(center, filtersRef.current.radiusKm)
  }, [runDetection])

  const rescan = useCallback(() => {
    const loc = userLocationRef.current
    if (!loc || scanning) return
    runDetection(loc, filtersRef.current.radiusKm)
  }, [scanning, runDetection])

  // Sync GeoJSON source when hills or filters change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('hills') as mapboxgl.GeoJSONSource | undefined
    if (!source) return

    const features = hills
      .filter(hill => isHillVisible(hill, filters))
      .map(hill => ({
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: hill.coordinates,
        },
        properties: {
          id: hill.id,
          color: DIFFICULTY_COLORS[hill.difficulty],
        },
      }))

    source.setData({ type: 'FeatureCollection', features })
  }, [hills, filters, mapReady])

  // Sync start-point markers when hills or filters change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(hills.map(h => h.id))

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id) }
    })

    for (const hill of hills) {
      if (!markersRef.current.has(hill.id)) {
        const el = createHillMarkerEl(hill, () => {
          setSelectedHill(hill)
          mapRef.current?.flyTo({ center: hill.center, zoom: 16, duration: 600 })
        })
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(hill.center)
          .addTo(map)
        markersRef.current.set(hill.id, marker)
      }
      const el = markersRef.current.get(hill.id)!.getElement()
      el.style.display = isHillVisible(hill, filters) ? 'flex' : 'none'
    }
  }, [hills, filters])

  // Update selected marker appearance
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      marker.getElement().classList.toggle('selected', id === selectedHill?.id)
    })
  }, [selectedHill])

  // Highlight selected hill line
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = ['==', ['get', 'id'], selectedHill?.id ?? ''] as any
    if (map.getLayer('hill-selected-glow')) map.setFilter('hill-selected-glow', f)
    if (map.getLayer('hill-selected')) map.setFilter('hill-selected', f)
  }, [selectedHill, mapReady])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <SearchBar
        onSelect={handleSearchSelect}
        mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN!}
      />

      <div className="fixed top-4 left-[344px] z-10 flex flex-col items-start gap-2">
        <button
          onClick={() => setShowSavedPanel(p => !p)}
          className={`w-11 h-11 flex items-center justify-center rounded-xl border transition-colors ${
            showSavedPanel
              ? 'bg-white text-black border-white'
              : 'bg-[#111] border-[#222] text-[#555] hover:text-white'
          }`}
          aria-label="Saved hills"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill={showSavedPanel ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 2h10a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z" />
          </svg>
        </button>
        {showSavedPanel && (
          <SavedHillsPanel
            hills={savedHills}
            onRemove={(id) => setSavedHills(prev => prev.filter(h => h.id !== id))}
            onSelect={handleSelectSavedHill}
          />
        )}
      </div>

      <FilterPanel
        filters={filters}
        onChange={setFilters}
        scanning={scanning}
        hillCount={hillCount}
        onRescan={rescan}
      />

      {(scanning || hillCount !== null) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-[#111] border border-[#222] rounded-lg px-4 py-2 text-[10px] font-semibold tracking-[0.12em] uppercase text-[#555] whitespace-nowrap">
            {scanning
              ? 'Scanning…'
              : hillCount === 0
              ? 'No hills found'
              : `${hillCount} hill${hillCount === 1 ? '' : 's'} found`}
          </div>
        </div>
      )}

      {selectedHill && (
        <HillDetailCard
          hill={selectedHill}
          onClose={() => setSelectedHill(null)}
          isSaved={savedHills.some(h => h.id === selectedHill.id)}
          onToggleSave={() => handleToggleSave(selectedHill)}
        />
      )}
    </div>
  )
}
