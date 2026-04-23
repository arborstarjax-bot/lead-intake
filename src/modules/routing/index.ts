// Barrel for the routing module.
//
// Routing owns everything that touches Google Maps — server-side
// drive-time / geocode (server/*) and the client-side Maps JS loader
// + RouteMap React component (client/*, ui/*). Calendar-side Google
// integration lives in its own module under @/modules/calendar.

export {
  getDriveTime,
  getDriveMatrix,
  createDriveMemo,
  MapsUnavailableError,
  type DriveResult,
} from "./server/maps";

export {
  geocode,
  geocodeMany,
  type LatLng,
} from "./server/geocode";

// Client-only: depends on window + runtime script injection. Keep
// gated to the components that need it (RouteMap today).
export { loadGoogleMaps } from "./client/maps-loader";

export { default as RouteMap } from "./ui/RouteMap";
export type {
  RouteMapStop,
  RouteMapHome,
  RouteMapMode,
} from "./ui/RouteMap";
