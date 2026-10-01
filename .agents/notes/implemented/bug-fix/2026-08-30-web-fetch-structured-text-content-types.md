# Agent Note: The HTTP fetch provider decodes structured text application types

Status: implemented

English | [中文](2026-08-30-web-fetch-structured-text-content-types.zh.md)

## Problem

The `web-fetch-http` provider's `classifyContentType` accepted only `text/*`, `application/json`, `application/xml`, and the `+json`/`+xml` suffixes; every other `Content-Type` was rejected with `WEB_UNSUPPORTED_CONTENT_TYPE`. Servers routinely label shell scripts, JavaScript, YAML, TOML, and CSV as `application/x-sh`, `application/javascript`, `application/yaml`, `application/toml`, or `application/csv`, so the model could not read those resources at all. The failure surfaced on a production deployment: a fetch of a `.sh` URL returned `unsupported content type "application/x-sh"` and the task stalled.

## Decision

`classifyContentType` recognizes the members of a `TEXT_APPLICATION_TYPES` set — `application/json`, `application/xml`, `application/javascript`, `application/x-javascript`, `application/x-sh`, `application/x-shellscript`, `application/x-python`, `application/yaml`, `application/x-yaml`, `application/toml`, `application/sql`, `application/csv` — plus `text/*` and the `+json`/`+xml` suffixes, and classifies all of them as `text`. The set lists MIME labels that carry human-readable text: structured configuration, source code, and data interchange. Fetching such a body decodes it as content; executing one remains the shell capability's approved path, which this provider does not touch. Binary labels, including `application/octet-stream`, still return `undefined` and fail loudly.

## Alternatives considered

**Accept every `application/*` label as text.** Rejected because binary bodies (`application/octet-stream`, PDFs, archives) would be decoded into replacement-character garbage and presented to the model as content; precise membership keeps the rejection meaningful.

**Add a request parameter letting the model override the classification.** Rejected because the defect is in the provider's policy, not in the request vocabulary; a forcing parameter would widen the tool surface and push every caller into working around the policy instead of fixing it.

**Add only `application/x-sh`.** Rejected because the same misclassification recurs for JavaScript, YAML, TOML, Python, SQL, and CSV labels; the deployment owner asked for the common structured-text class to work, not one MIME label.

## Consequences

Fetches of shell scripts, JavaScript, YAML, TOML, SQL, CSV, and Python resources decode as text and reach the model. The five new unit cases pin `application/x-sh`, `application/x-shellscript`, `application/javascript`, `application/yaml`, and `application/toml` to `text`. New structured-text labels require a one-line addition to `TEXT_APPLICATION_TYPES`; a label left out continues to fail loudly rather than decode as mojibake.
