import mapboxgl from 'mapbox-gl'
import type { Hill, DifficultyLevel, TerrainType } from './hillTypes'

const MIN_GRADE_PCT = 5

function distM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = (b[1] - a[1]) * Math.PI / 180
  const dLng = (b[0] - a[0]) * Math.PI / 180
  const lat1 = a[1] * Math.PI / 180
  const lat2 = b[1] * Math.PI / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

function lerp(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

// Resample a polyline so no segment is longer than maxStepM
function resampleLine(coords: [number, number][], maxStepM: number): [number, number][] {
  if (coords.length < 2) return coords
  const out: [number, number][] = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const d = distM(coords[i - 1], coords[i])
    const steps = Math.max(1, Math.round(d / maxStepM))
    for (let j = 1; j <= steps; j++) {
      out.push(lerp(coords[i - 1], coords[i], j / steps))
    }
  }
  return out
}

function gradePercent(elevDiff: number, horizDist: number): number {
  return Math.abs((elevDiff / horizDist) * 100)
}

function difficultyFromGrade(grade: number): DifficultyLevel {
  if (grade < 8) return 'easy'
  if (grade < 12) return 'moderate'
  return 'hard'
}

function terrainFromFeature(feature: mapboxgl.MapboxGeoJSONFeature): TerrainType {
  const cls = feature.properties?.class as string | undefined
  if (cls) {
    if (['path', 'pedestrian', 'footway', 'steps'].includes(cls)) return 'path'
    if (['track', 'service'].includes(cls)) return 'trail'
    if (['secondary', 'tertiary', 'street', 'primary', 'motorway', 'trunk'].includes(cls)) return 'road'
  }
  const lid = feature.layer?.id ?? ''
  if (lid.includes('path') || lid.includes('pedestrian') || lid.includes('steps')) return 'path'
  if (lid.includes('street') || lid.includes('primary') || lid.includes('secondary') || lid.includes('motorway')) return 'road'
  return 'trail'
}

function isRoadLike(feature: mapboxgl.MapboxGeoJSONFeature): boolean {
  if (feature.geometry.type !== 'LineString') return false
  const lid = feature.layer?.id ?? ''
  // Include any Mapbox road/path layer
  if (lid.startsWith('road') || lid.includes('path') || lid.includes('pedestrian') || lid.includes('trail')) return true
  if (feature.sourceLayer === 'road') return true
  return false
}

function deduplicateHills(hills: Hill[]): Hill[] {
  const kept: Hill[] = []
  for (const hill of hills) {
    const tooClose = kept.some(k => {
      const dx = (k.center[0] - hill.center[0]) * 111320
      const dy = (k.center[1] - hill.center[1]) * 111320
      return Math.sqrt(dx * dx + dy * dy) < 80
    })
    if (!tooClose) kept.push(hill)
  }
  return kept
}

export function detectHills(
  map: mapboxgl.Map,
  userLng: number,
  userLat: number,
  maxDistanceMeters = 5000,
  stepMeters = 20,
): Hill[] {
  const userCoord: [number, number] = [userLng, userLat]
  const hills: Hill[] = []
  const seenKeys = new Set<string>()

  const rendered = map.queryRenderedFeatures()

  for (const feature of rendered) {
    if (!isRoadLike(feature)) continue
    if (!feature.geometry || feature.geometry.type !== 'LineString') continue

    const geom = feature.geometry as GeoJSON.LineString
    if (!geom.coordinates || geom.coordinates.length < 2) continue

    // Normalize to [lng, lat] pairs — coordinates may include a z component
    const rawCoords: [number, number][] = geom.coordinates.map(c => [c[0], c[1]])

    // Deduplicate same road segment appearing across tile boundaries
    const key = feature.id != null
      ? `${feature.layer?.id ?? ''}-${feature.id}`
      : `${rawCoords[0].join(',')}-${rawCoords[rawCoords.length - 1].join(',')}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    // Skip if entirely outside search radius
    if (!rawCoords.some(c => distM(userCoord, c) <= maxDistanceMeters)) continue

    const coords = resampleLine(rawCoords, stepMeters)
    const elevations = coords.map(c => map.queryTerrainElevation(c, { exaggerated: false }))
    const terrain = terrainFromFeature(feature)

    let segStart: number | null = null

    for (let i = 1; i < coords.length; i++) {
      const e0 = elevations[i - 1]
      const e1 = elevations[i]

      if (e0 == null || e1 == null) {
        if (segStart !== null) { pushSegment(segStart, i - 1); segStart = null }
        continue
      }

      const d = distM(coords[i - 1], coords[i])
      if (d < 0.1) continue

      const grade = gradePercent(e1 - e0, d)

      if (grade >= MIN_GRADE_PCT) {
        if (segStart === null) segStart = i - 1
      } else {
        if (segStart !== null) { pushSegment(segStart, i - 1); segStart = null }
      }
    }
    if (segStart !== null) pushSegment(segStart, coords.length - 1)

    function pushSegment(start: number, end: number) {
      let segCoords = coords.slice(start, end + 1)
      let segElevs = elevations.slice(start, end + 1).filter((e): e is number => e !== null)
      if (segCoords.length < 2 || segElevs.length < 2) return

      let length = 0
      for (let i = 1; i < segCoords.length; i++) length += distM(segCoords[i - 1], segCoords[i])
      if (length < stepMeters * 2) return

      // Normalize direction: always low → high
      if (segElevs[0] > segElevs[segElevs.length - 1]) {
        segCoords = [...segCoords].reverse()
        segElevs = [...segElevs].reverse()
      }

      const totalRise = segElevs[segElevs.length - 1] - segElevs[0]
      if (totalRise <= 0) return

      const avgGrade = gradePercent(totalRise, length)
      const elevationGain = Math.round(totalRise)
      const midIdx = Math.floor(segCoords.length / 2)
      const center = segCoords[midIdx]

      if (distM(userCoord, center) > maxDistanceMeters) return

      hills.push({
        id: `hill-${hills.length}-${key}-${start}`,
        center,
        startCoord: segCoords[0],
        endCoord: segCoords[segCoords.length - 1],
        coordinates: segCoords,
        inclinePct: Math.round(avgGrade * 10) / 10,
        length: Math.round(length),
        difficulty: difficultyFromGrade(avgGrade),
        elevationGain,
        terrain,
        elevationProfile: segElevs.map((el, idx) => ({
          distance: Math.round(idx * stepMeters),
          elevation: Math.round(el * 10) / 10,
        })),
      })
    }
  }

  return deduplicateHills(hills)
}
