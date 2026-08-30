# Agent Note: Host requests join the sub-path mount via document.baseURI

Status: implemented

English | [中文](2026-08-30-host-request-subpath-base-resolution.zh.md)

## Problem

Behind a reverse proxy mounting the web client at a sub-path (`/deepseek-harness/`), the Session-log export dialog always failed with HTTP 404. The Host injects `<base href="/deepseek-harness/">` into index.html for exactly this deployment, but the export controller built its request URL with a root-absolute path: `new URL('/api/session.export', base)` discards the base pathname and lands outside the mounted prefix. The same root-absolute pattern existed in the connection RPC resolver and the gateway stream client, and the base fallback chain (`document.baseURI` → page origin → `http://dsh.internal` sentinel) was duplicated three times across packages.

## Decision

Every browser request to the Host resolves its base through `resolveHostBase()` from `@deepseek-ai/dsh-client-connection/client/host-base` and joins a path without a leading slash, so the URL join keeps the `<base href>` pathname. The helper returns `document.baseURI` when a document exists, otherwise the page origin when it is not `null`, otherwise the `http://dsh.internal` sentinel that keeps fixture URLs structurally valid while unreachable. Three consumers share it: the connection RPC client, the session-log export controller, and the gateway remote stream URL builder, which converts the resolved URL to the `ws` protocol.

The leaf module ships as its own subpath export wired through three planes. The connection `exports` map and a tsdown lib entry feed the shipped client bundle. The client bundle purity gate's INLINE_SAFE set allows cross-plugin inlining of this pure-value module. The source plane resolves the subpath through a hand-written alias in tsconfig.base.json plus explicit client-face project references from `dsh-session-log-export` and `dsh-api-gateway` to the connection client project, so `tsc -b` redirects the import to the referenced project's declaration output instead of pulling the source file across a rootDir.

## Alternatives considered

**Fix only the export controller's URL.** Rejected because it left the duplicated base fallback and the same latent escape in RPC and the stream client; the next client-side consumer would copy a private base resolver and reintroduce the class of bug.

**Export the helper from the connection `./client` entry.** Rejected because that entry pulls `ConnectionController` and the fixture transport into every importer's client bundle, inflating the build for one pure function.

**List the module in each consumer's `dsh.client.external` table.** Rejected because external-table rows name entry bundle export faces, not leaf subpaths, and externalizing would preserve a runtime module split that INLINE_SAFE inlining already deletes.

## Consequences

Root-absolute fetch paths no longer appear in browser client code. A consumer that joins a root-absolute path still escapes the mount, so the regression test pins the export dialog to `/deepseek-harness/api/session.export` under a shadowed `document.baseURI`. Base resolution now has one owner, and coverage of the sentinel, origin, and baseURI branches moved with the code into the connection and session-log-export client suites. Adding a cross-package client subpath still requires the three-plane wiring (exports map, INLINE_SAFE entry, source alias plus client-face reference); the existing wildcard alias cannot cover it because TS project references have no wildcard form.
