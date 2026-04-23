// Barrel for the workspace module.
//
// Today the only public surface is the WorkspaceClient UI component
// rendered by src/app/workspace/page.tsx. R-9 will pull the admin /
// invite / roster server helpers in here once the api routes are
// refactored to thin delegators; for now those still live under
// src/app/api/workspace/*.

export { WorkspaceClient } from "./ui/WorkspaceClient";
