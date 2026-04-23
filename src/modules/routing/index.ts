// Client-safe barrel for the routing module.
//
// Only the client-side Maps JS loader + the RouteMap React component
// are exposed here. Anything that depends on `import "server-only"`
// (drive-time matrix, geocoder) lives under @/modules/routing/server.
// Mixing them in a single barrel breaks the webpack client bundle
// because side-effect imports don't tree-shake reliably.

export { loadGoogleMaps } from "./client/maps-loader";

export { default as RouteMap } from "./ui/RouteMap";
export type {
  RouteMapStop,
  RouteMapHome,
  RouteMapMode,
} from "./ui/RouteMap";
