# ADR-0012: Document exports — Markdown, PDF via @react-pdf/renderer, DOCX via `docx`

**Status:** Accepted (resolves the renderer choice left open in D-012)
**Date:** 2026-11-09
**Deciders:** Phase 03

## Context
"Copy All", "Export PDF" and "Export Document" are dead buttons (UX-03); exports are missing
(GAP-04). The spec requires copy, PDF and DOCX. Documents are structured JSON (DocumentVersion
content) with citations.

## Decision
- One intermediate representation: `toExportBlocks(type, content, options)` in
  `apps/api/src/exports/` → headings, paragraphs, bullet lists, tables, citation footnotes.
- **Markdown / plain text:** own serializer from blocks (also used for clipboard copy client-side via
  a shared serializer in `packages/shared`).
- **PDF:** **`@react-pdf/renderer`** on the server (pure JS, no Chromium in images), embedded fonts
  matching the P04 type scale, A4/Letter by user locale.
- **DOCX:** **`docx`** npm package with Word heading styles (editable in Word/Google Docs).
- Endpoint: `GET /documents/:id/export?format=md|txt|pdf|docx&version=` (API_CONTRACT_V2 §13.2),
  rate class `export`. Citations rendered as footnotes with GitHub URLs (resume exports omit
  citations by default — paste-ready — with an option to include).
- Filenames: `<type>-<period>-v<n>.<ext>`.

## Options Considered
### Option A: @react-pdf/renderer + docx (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free; small image size |
| Scalability | CPU-light; runs in API |
| Team familiarity | Medium (React-like) |

**Pros:** deterministic output, no headless browser, testable (magic bytes + text extraction).
**Cons:** layout is not CSS; templates are written twice (PDF + DOCX) from the same blocks.

### Option B: Headless Chromium (Playwright) HTML → PDF
**Pros:** reuse web CSS. **Cons:** +300 MB images, process management, slower, sandbox concerns. Rejected.

### Option C: Client-side PDF (browser print)
**Pros:** zero server work. **Cons:** inconsistent output; no DOCX. Kept only as "print-friendly view" for the career page.

## Consequences
- Easier: working exports (fixes UX-03 for documents, GAP-04).
- Harder: two templates per type to keep visually aligned.

## Action Items
1. [ ] P11: blocks IR, md/txt/pdf/docx renderers, endpoint, magic-byte/content tests.
