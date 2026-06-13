/**
 * Lightweight geo-distance utilities for campaign call ordering.
 * Uses zip code numeric proximity as a fast heuristic (no API calls).
 * For the Jacksonville, FL service area this works well since zip codes
 * are assigned geographically — nearby zips have close numeric values.
 *
 * Falls back to address-based Google Distance Matrix for exact ordering
 * only when explicitly requested (not used in hot paths).
 */

/**
 * Haversine distance in miles between two lat/lng points.
 */
export function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Jacksonville-area zip code centroids (lat, lng).
 * Covers Duval, St. Johns, Nassau, Clay, and Baker counties.
 * This avoids any API calls for campaign sorting.
 */
const JAX_ZIP_COORDS: Record<string, [number, number]> = {
  // Duval County (Jacksonville)
  "32099": [30.3322, -81.6557],
  "32201": [30.3280, -81.6600],
  "32202": [30.3280, -81.6557],
  "32203": [30.3280, -81.6700],
  "32204": [30.3150, -81.6800],
  "32205": [30.3000, -81.7100],
  "32206": [30.3500, -81.6400],
  "32207": [30.2900, -81.6400],
  "32208": [30.3800, -81.6800],
  "32209": [30.3500, -81.7000],
  "32210": [30.2700, -81.7500],
  "32211": [30.3300, -81.5800],
  "32212": [30.2200, -81.6800],
  "32214": [30.2200, -81.6400],
  "32216": [30.2800, -81.5600],
  "32217": [30.2500, -81.6300],
  "32218": [30.4400, -81.6500],
  "32219": [30.3800, -81.7700],
  "32220": [30.3300, -81.8200],
  "32221": [30.2800, -81.8200],
  "32222": [30.2200, -81.8000],
  "32223": [30.1700, -81.6300],
  "32224": [30.2500, -81.5100],
  "32225": [30.3300, -81.5100],
  "32226": [30.4400, -81.5100],
  "32227": [30.3800, -81.4200],
  "32228": [30.3900, -81.4100],
  "32233": [30.3200, -81.4100], // Atlantic Beach
  "32234": [30.2200, -81.9000],
  "32235": [30.2600, -81.5600],
  "32244": [30.2200, -81.7200],
  "32245": [30.2700, -81.5800],
  "32246": [30.2900, -81.5100],
  "32247": [30.2500, -81.6300],
  "32250": [30.2900, -81.3900], // Jacksonville Beach
  "32254": [30.3400, -81.7200],
  "32256": [30.2200, -81.5400],
  "32257": [30.1900, -81.5800],
  "32258": [30.1600, -81.5600],
  "32259": [30.1000, -81.5800], // St. Johns
  "32260": [30.0800, -81.5500],
  "32266": [30.3400, -81.4000], // Neptune Beach
  "32277": [30.3700, -81.6000],
  // Nassau County
  "32009": [30.6100, -81.5700],
  "32011": [30.6300, -81.5400],
  "32034": [30.6700, -81.4600], // Fernandina Beach
  "32035": [30.6700, -81.4600],
  "32041": [30.5400, -81.5100],
  "32046": [30.7200, -81.7900],
  "32097": [30.5800, -81.8200],
  // St. Johns County
  "32080": [29.8600, -81.2700], // St. Augustine Beach
  "32081": [30.0800, -81.3800], // Ponte Vedra
  "32082": [30.1800, -81.3900], // Ponte Vedra Beach
  "32084": [29.8900, -81.3100], // St. Augustine
  "32086": [29.8400, -81.3200],
  "32092": [30.0200, -81.5200],
  "32095": [29.9600, -81.3600],
  // Clay County
  "32003": [30.1000, -81.7100], // Fleming Island
  "32006": [30.0800, -81.6800],
  "32043": [30.0000, -81.7100], // Green Cove Springs
  "32065": [30.1700, -81.7300], // Orange Park
  "32067": [30.1700, -81.7300],
  "32068": [30.0800, -81.8300], // Middleburg
  "32073": [30.1700, -81.7300], // Orange Park
  // Baker County
  "32040": [30.2900, -82.1600], // Glen St. Mary
  "32063": [30.2900, -82.1000], // Macclenny
  "32087": [30.3400, -82.0400], // Sanderson
};

/**
 * Get approximate coordinates for a zip code. Returns [lat, lng] or null
 * if not in the lookup table.
 */
export function zipToCoords(zip: string): [number, number] | null {
  const clean = (zip ?? "").trim().slice(0, 5);
  return JAX_ZIP_COORDS[clean] ?? null;
}

/**
 * Sort leads by distance from a home zip code (closest first).
 * Leads without a known zip are placed at the end.
 */
export function sortByDistanceFromHome<T extends { zip?: string | null }>(
  leads: T[],
  homeZip: string
): T[] {
  const homeCoords = zipToCoords(homeZip);
  if (!homeCoords) return leads; // Can't sort without home coords

  return [...leads].sort((a, b) => {
    const aCoords = zipToCoords(a.zip ?? "");
    const bCoords = zipToCoords(b.zip ?? "");
    // Leads without coords go to the end
    if (!aCoords && !bCoords) return 0;
    if (!aCoords) return 1;
    if (!bCoords) return -1;
    const aDist = haversineDistanceMiles(homeCoords[0], homeCoords[1], aCoords[0], aCoords[1]);
    const bDist = haversineDistanceMiles(homeCoords[0], homeCoords[1], bCoords[0], bCoords[1]);
    return aDist - bDist;
  });
}
