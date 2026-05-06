'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import FilterPanel from './FilterPanel'
import HillDetailCard from './HillDetailCard'
import HillStreetView from './HillStreetView'
import SavedHillsPanel from './SavedHillsPanel'
import SearchBar from './SearchBar'
import { detectHills } from '../lib/hillDetection'
import type { Hill, Filters } from '../lib/hillTypes'
import { DEFAULT_FILTERS } from '../lib/hillTypes'

const FALLBACK_CENTER: [number, number] = [4.9041, 52.3676]
const USER_ZOOM = 13
const REFINE_ZOOM_THRESHOLD = 14

const DIFFICULTY_COLORS = {
  easy: '#4ade80',
  moderate: '#fb923c',
  hard: '#f87171',
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function buildPulseGradient(t: number, color: string): mapboxgl.Expression {
  const tailLen = 0.30
  const headLen = 0.06
  const raw: [number, string][] = [
    [0,                              'rgba(255,255,255,0)'],
    [Math.max(0, t - tailLen),       'rgba(255,255,255,0)'],
    [Math.max(0, t - tailLen * 0.5), hexToRgba(color, 0.15)],
    [Math.max(0, t - headLen),       hexToRgba(color, 0.55)],
    [t,                              'rgba(255,255,255,0.95)'],
    [Math.min(1, t + headLen),       'rgba(255,255,255,0)'],
    [1,                              'rgba(255,255,255,0)'],
  ]
  const stops = raw.filter((s, i) => i === 0 || s[0] - raw[i - 1][0] > 0.0001)
  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']]
  for (const [pos, clr] of stops) expr.push(pos, clr)
  return expr as mapboxgl.Expression
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

function distKm(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)
  const dy = (b[1] - a[1]) * 110.574
  return Math.sqrt(dx * dx + dy * dy)
}

function mergeHills(existing: Hill[], incoming: Hill[]): Hill[] {
  const merged = [...incoming]
  for (const hill of existing) {
    const duplicate = merged.some(h => {
      const dx = (h.center[0] - hill.center[0]) * 111320
      const dy = (h.center[1] - hill.center[1]) * 111320
      return Math.sqrt(dx * dx + dy * dy) < 80
    })
    if (!duplicate) merged.push(hill)
  }
  return merged
}

function isHillVisible(hill: Hill, filters: Filters, userLocation?: [number, number]): boolean {
  if (userLocation && distKm(hill.center, userLocation) > filters.radiusKm) return false
  if (hill.inclinePct < filters.inclineMin || hill.inclinePct > filters.inclineMax) return false
  if (hill.length < filters.lengthMin || hill.length > filters.lengthMax) return false
  if (filters.difficulty !== 'any' && hill.difficulty !== filters.difficulty) return false
  if (!filters.terrain.has(hill.terrain)) return false
  return true
}


function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
}

function createHillMarkerEl(hill: Hill, onHover: (h: Hill | null) => void, onClick: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'hill-marker'
  el.style.background = DIFFICULTY_COLORS[hill.difficulty]
  el.innerHTML = `<svg viewBox="0 0 12 10" width="9" height="9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,9 6,1 11,9"/></svg>`
  el.addEventListener('mouseenter', () => onHover(hill))
  el.addEventListener('mouseleave', () => onHover(null))
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
  const hoverPopupRef = useRef<mapboxgl.Popup | null>(null)
  const pulseAnimRef = useRef<number | null>(null)
  const userLocationRef = useRef<[number, number] | null>(null)
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null)
  const cancelDetectionRef = useRef<() => void>(() => {})
  const filtersRef = useRef<Filters>(DEFAULT_FILTERS)
  const refinedFetchController = useRef<AbortController | null>(null)
  const refinedHillCoordsRef = useRef<Map<string, [number, number][]>>(new Map())
  const batchFetchingRef = useRef<Set<string>>(new Set())
  const [mapReady, setMapReady] = useState(false)
  const [refinedCoords, setRefinedCoords] = useState<[number, number][] | null>(null)
  const [refinedVersion, setRefinedVersion] = useState(0)

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

  const runDetection = useCallback((center: [number, number], radiusKm: number, accumulate = false) => {
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
      setHills(prev => {
        const next = accumulate ? mergeHills(prev, found) : found
        setHillCount(next.length)
        return next
      })
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
      attributionControl: false,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'top-right')

    map.on('load', () => {
      const topRight = map.getContainer().querySelector<HTMLElement>('.mapboxgl-ctrl-top-right')
      if (topRight) { topRight.style.right = '312px'; topRight.style.top = '16px' }

      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1 })

      // GeoJSON source for all hill segments (overview)
      map.addSource('hills', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Dedicated source for the selected hill — populated with original coords
      // immediately on click, then upgraded to Directions API geometry async
      map.addSource('hill-selected-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        lineMetrics: true,
      })

      // Wide outer glow for selected hill
      map.addLayer({
        id: 'hill-selected-glow',
        type: 'line',
        source: 'hill-selected-route',
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
        source: 'hill-selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 5,
          'line-opacity': 1,
        },
      })

      // Animated pulse (comet travelling uphill)
      map.addLayer({
        id: 'hill-selected-pulse',
        type: 'line',
        source: 'hill-selected-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 6,
          'line-opacity': 1,
          'line-gradient': [
            'interpolate', ['linear'], ['line-progress'],
            0, 'rgba(255,255,255,0)',
            1, 'rgba(255,255,255,0)',
          ] as mapboxgl.Expression,
        },
      })

      // Directional arrows along each hill line
      map.addLayer({
        id: 'hill-arrows',
        type: 'symbol',
        source: 'hills',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 50,
          'text-field': '▶',
          'text-size': 20,
          'text-keep-upright': false,
          'text-rotation-alignment': 'map',
          'text-pitch-alignment': 'viewport',
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': 1,
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 2.5,
        },
      })

      // Start dot + end square point features
      map.addSource('hill-endpoints', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: 'hill-start-dots',
        type: 'circle',
        source: 'hill-endpoints',
        filter: ['==', ['get', 'role'], 'start'],
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000000',
          'circle-stroke-opacity': 0.5,
        },
      })

      map.addLayer({
        id: 'hill-end-squares',
        type: 'symbol',
        source: 'hill-endpoints',
        filter: ['==', ['get', 'role'], 'end'],
        layout: {
          'text-field': '■',
          'text-size': 14,
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-opacity': 0.9,
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
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

      map.on('moveend', () => {
        if (map.getZoom() < REFINE_ZOOM_THRESHOLD) return
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        const visibleHills = hillsRef.current.filter(h => isHillVisible(h, filtersRef.current, userLocationRef.current ?? undefined))
        for (const hill of visibleHills) {
          if (refinedHillCoordsRef.current.has(hill.id)) continue
          if (batchFetchingRef.current.has(hill.id)) continue
          batchFetchingRef.current.add(hill.id)
          const [sLng, sLat] = hill.startCoord
          const [eLng, eLat] = hill.endCoord
          const url =
            `https://api.mapbox.com/directions/v5/mapbox/walking/` +
            `${sLng},${sLat};${eLng},${eLat}` +
            `?geometries=geojson&overview=full&access_token=${token}`
          fetch(url)
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(data => {
              const coords = data?.routes?.[0]?.geometry?.coordinates
              if (coords?.length > 1) {
                refinedHillCoordsRef.current.set(hill.id, coords)
                setRefinedVersion(v => v + 1)
              }
            })
            .catch(() => { batchFetchingRef.current.delete(hill.id) })
        }
      })

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
    runDetection(loc, filters.radiusKm, true)
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

  // Clear refined cache when a new detection run produces fresh hills
  useEffect(() => {
    refinedHillCoordsRef.current.clear()
    batchFetchingRef.current.clear()
  }, [hills])

  // Sync GeoJSON source when hills, filters, or refined coords change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('hills') as mapboxgl.GeoJSONSource | undefined
    if (!source) return

    const visibleHills = hills.filter(hill => isHillVisible(hill, filters, userLocationRef.current ?? undefined))

    const features = visibleHills.map(hill => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: refinedHillCoordsRef.current.get(hill.id) ?? hill.coordinates,
      },
      properties: {
        id: hill.id,
        difficulty: hill.difficulty,
        color: DIFFICULTY_COLORS[hill.difficulty],
      },
    }))

    source.setData({ type: 'FeatureCollection', features })

    const endpointSource = map.getSource('hill-endpoints') as mapboxgl.GeoJSONSource | undefined
    if (endpointSource) {
      const endpointFeatures = visibleHills.flatMap(hill => {
        const color = DIFFICULTY_COLORS[hill.difficulty]
        const lineCoords = refinedHillCoordsRef.current.get(hill.id) ?? hill.coordinates
        const startPos = lineCoords[0]
        const endPos = lineCoords[lineCoords.length - 1]
        return [
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: startPos },
            properties: { role: 'start', color },
          },
          {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: endPos },
            properties: { role: 'end', color },
          },
        ]
      })
      endpointSource.setData({ type: 'FeatureCollection', features: endpointFeatures })
    }
  }, [hills, filters, mapReady, refinedVersion])

  // Sync start-point markers when hills or filters change
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(hills.map(h => h.id))

    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) { marker.remove(); markersRef.current.delete(id) }
    })

    if (!hoverPopupRef.current) {
      hoverPopupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        anchor: 'bottom',
        offset: 14,
        className: 'hill-hover-popup',
      })
    }
    const hoverPopup = hoverPopupRef.current

    for (const hill of hills) {
      if (!markersRef.current.has(hill.id)) {
        const el = createHillMarkerEl(
          hill,
          (hovered) => {
            if (hovered) {
              hoverPopup
                .setLngLat(hovered.center)
                .setHTML(`${hovered.inclinePct}%&nbsp;&middot;&nbsp;${formatLength(hovered.length)}&nbsp;&middot;&nbsp;+${hovered.elevationGain}m`)
                .addTo(map)
            } else {
              hoverPopup.remove()
            }
          },
          () => {
            setSelectedHill(hill)
            mapRef.current?.flyTo({ center: hill.center, zoom: 16, duration: 600 })
          },
        )
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(hill.center)
          .addTo(map)
        markersRef.current.set(hill.id, marker)
      }
      const el = markersRef.current.get(hill.id)!.getElement()
      el.style.display = isHillVisible(hill, filters, userLocationRef.current ?? undefined) ? 'flex' : 'none'
    }
  }, [hills, filters])

  // Update selected marker appearance
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      marker.getElement().classList.toggle('selected', id === selectedHill?.id)
    })
  }, [selectedHill])

  // Pulse animation along selected route
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (pulseAnimRef.current !== null) {
      cancelAnimationFrame(pulseAnimRef.current)
      pulseAnimRef.current = null
    }

    const blank: mapboxgl.Expression = ['interpolate', ['linear'], ['line-progress'], 0, 'rgba(255,255,255,0)', 1, 'rgba(255,255,255,0)']

    if (!selectedHill) {
      map.setPaintProperty('hill-selected-pulse', 'line-gradient', blank)
      return
    }

    const color = DIFFICULTY_COLORS[selectedHill.difficulty]
    const period = 2000

    function frame() {
      const t = (Date.now() % period) / period
      map.setPaintProperty('hill-selected-pulse', 'line-gradient', buildPulseGradient(t, color))
      pulseAnimRef.current = requestAnimationFrame(frame)
    }

    pulseAnimRef.current = requestAnimationFrame(frame)

    return () => {
      if (pulseAnimRef.current !== null) cancelAnimationFrame(pulseAnimRef.current)
    }
  }, [selectedHill, mapReady])

  // Effect A: immediately populate hill-selected-route with original tile geometry (or clear on deselect)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource('hill-selected-route') as mapboxgl.GeoJSONSource | undefined
    if (!source) return

    setRefinedCoords(null)

    if (!selectedHill) {
      source.setData({ type: 'FeatureCollection', features: [] })
      if (map.getLayer('hill-lines')) map.setFilter('hill-lines', null)
      return
    }

    // Hide selected hill from the overview layer to prevent double-rendering
    if (map.getLayer('hill-lines')) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.setFilter('hill-lines', ['!=', ['get', 'id'], selectedHill.id] as any)
    }

    const existingRefined = refinedHillCoordsRef.current.get(selectedHill.id)
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: existingRefined ?? selectedHill.coordinates },
        properties: { id: selectedHill.id, color: DIFFICULTY_COLORS[selectedHill.difficulty] },
      }],
    })
  }, [selectedHill, mapReady])

  // Effect B: fetch refined route geometry from Mapbox Directions API
  useEffect(() => {
    if (!mapReady || !selectedHill) return

    refinedFetchController.current?.abort()
    const controller = new AbortController()
    refinedFetchController.current = controller

    const [sLng, sLat] = selectedHill.startCoord
    const [eLng, eLat] = selectedHill.endCoord
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/walking/` +
      `${sLng},${sLat};${eLng},${eLat}` +
      `?geometries=geojson&overview=full&access_token=${token}`

    fetch(url, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const coords = data?.routes?.[0]?.geometry?.coordinates
        if (coords?.length > 1) {
          refinedHillCoordsRef.current.set(selectedHill.id, coords)
          batchFetchingRef.current.delete(selectedHill.id)
          setRefinedCoords(coords)
          setRefinedVersion(v => v + 1)
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') { /* silent fallback — original stays */ }
      })

    return () => controller.abort()
  }, [selectedHill, mapReady])

  // Effect C: apply refined coords to source once they arrive
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !selectedHill || !refinedCoords) return
    const source = map.getSource('hill-selected-route') as mapboxgl.GeoJSONSource | undefined
    if (!source) return

    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: refinedCoords },
        properties: { id: selectedHill.id, color: DIFFICULTY_COLORS[selectedHill.difficulty] },
      }],
    })
  }, [refinedCoords, selectedHill, mapReady])

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

      {scanning && (
        <div className="fixed inset-0 pointer-events-none z-10" style={{ right: '320px' }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative" style={{ width: 56, height: 56 }}>
              <div className="sonar-ring" style={{ animationDelay: '0s' }} />
              <div className="sonar-ring" style={{ animationDelay: '0.7s' }} />
              <div className="sonar-ring" style={{ animationDelay: '1.4s' }} />
              <div className="sonar-dot absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="bg-[#111] border border-[#222] rounded-lg px-4 py-2 text-[10px] font-semibold tracking-[0.12em] uppercase text-[#555] whitespace-nowrap flex items-center gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#fb923c] animate-pulse" />
              Scanning
            </div>
          </div>
        </div>
      )}

      {!scanning && hillCount !== null && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-[#111] border border-[#222] rounded-lg px-4 py-2 text-[10px] font-semibold tracking-[0.12em] uppercase text-[#555] whitespace-nowrap">
            {hillCount === 0 ? 'No hills found' : `${hillCount} hill${hillCount === 1 ? '' : 's'} found`}
          </div>
        </div>
      )}

      {selectedHill && (
        <div className="fixed left-4 bottom-4 z-20 flex flex-col gap-2 items-start">
          <HillStreetView hill={selectedHill} />
          <HillDetailCard
            hill={selectedHill}
            onClose={() => setSelectedHill(null)}
            isSaved={savedHills.some(h => h.id === selectedHill.id)}
            onToggleSave={() => handleToggleSave(selectedHill)}
          />
        </div>
      )}
    </div>
  )
}
