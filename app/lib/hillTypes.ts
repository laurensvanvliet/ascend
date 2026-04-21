export type DifficultyLevel = 'easy' | 'moderate' | 'hard'
export type TerrainType = 'road' | 'trail' | 'path' | 'mixed'

export interface Hill {
  id: string
  center: [number, number]
  startCoord: [number, number]
  endCoord: [number, number]
  coordinates: [number, number][]
  inclinePct: number
  length: number
  difficulty: DifficultyLevel
  terrain: TerrainType
  elevationGain: number
  elevationProfile: { distance: number; elevation: number }[]
}

export const RADIUS_OPTIONS = [2, 5, 10, 25] as const
export type RadiusKm = typeof RADIUS_OPTIONS[number]

export interface Filters {
  inclineMin: number
  inclineMax: number
  lengthMin: number
  lengthMax: number
  difficulty: 'any' | DifficultyLevel
  terrain: Set<TerrainType>
  radiusKm: RadiusKm
}

export const DEFAULT_FILTERS: Filters = {
  inclineMin: 0,
  inclineMax: 40,
  lengthMin: 50,
  lengthMax: 2000,
  difficulty: 'any',
  terrain: new Set(['road', 'trail', 'path', 'mixed']),
  radiusKm: 5,
}
