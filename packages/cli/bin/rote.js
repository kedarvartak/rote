#!/usr/bin/env node
// The published package bundles internal workspaces so a clean-machine npx run
// never depends on unpublished @rote/* packages or a TypeScript runtime.
await import('../dist/cli-entry.js');
