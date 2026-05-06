import { type NextRequest } from 'next/server'

async function hasOutdoorPanorama(lat: string, lng: string, key: string): Promise<boolean> {
  const url =
    `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${lat},${lng}&source=outdoor&radius=50&key=${key}`
  const res = await fetch(url)
  if (!res.ok) return false
  const data = await res.json()
  return data.status === 'OK'
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const key = process.env.GOOGLE_STREET_VIEW_API_KEY
  if (!key) return new Response('Street View not configured', { status: 503 })

  const candidatesParam = searchParams.get('candidates')
  if (!candidatesParam) return new Response('Missing candidates', { status: 400 })

  // candidates = "lat,lng,heading;lat,lng,heading;..."
  const candidates = candidatesParam.split(';').map(c => {
    const [lat, lng, heading] = c.split(',')
    return { lat, lng, heading: heading ?? '0' }
  }).filter(c => c.lat && c.lng)

  if (candidates.length === 0) return new Response('Invalid candidates', { status: 400 })

  // Find first candidate with a good outdoor panorama nearby
  let chosen = candidates[0]
  for (const candidate of candidates) {
    if (await hasOutdoorPanorama(candidate.lat, candidate.lng, key)) {
      chosen = candidate
      break
    }
  }

  const url =
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=576x200&location=${chosen.lat},${chosen.lng}&heading=${chosen.heading}` +
    `&pitch=8&fov=90&source=outdoor&key=${key}`

  const res = await fetch(url)
  if (!res.ok) return new Response('Street View unavailable', { status: res.status })

  const contentLength = res.headers.get('content-length')
  if (contentLength && parseInt(contentLength) < 5000) {
    return new Response('No imagery', { status: 404 })
  }

  const buffer = await res.arrayBuffer()
  return new Response(buffer, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
    },
  })
}
