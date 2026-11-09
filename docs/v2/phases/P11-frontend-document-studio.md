# Phase 11 — Frontend: AI Document Studio

| | |
|---|---|
| **Goal** | Deliver a polished document experience: generate Resume / Appraisal / Promotion documents with live streaming, evidence citations, inline editing, versions, a documents library, and working exports (copy, Markdown, PDF, DOCX). |
| **Type** | Code (web + small API for exports) |
| **Prerequisites** | P08 and P09 merged |
| **Parallel with** | P10 |
| **Effort** | 1 session (large) |

## Context
v0.1.0: three separate generate pages with a spinner, results lost on navigation, no documents
library UI (API existed), "Copy All"/"Export PDF" buttons with no handlers, no appraisal export,
no editing, no evidence. P08 provides documents API with SSE streaming, versions, regenerate,
citations and quotas. Exports decision: D-012 + ADR.

## Read first
`design/SCREENS.md` (documents library, studios, viewer/editor), `design/FLOWS.md` (generate →
stream → edit → export), `blueprint/API_CONTRACT_V2.md` (documents + SSE), P08 handoff (SSE event
contract), exports ADR. Skills: `design-skills:interaction-design`, `design-skills:ux-writing`,
`anthropic-skills:docx` / `anthropic-skills:pdf` if helpful for export formatting.

## Objectives
1. One coherent "Documents" area with type-specific creation flows and a shared viewer/editor.
2. Streaming generation with clear progress, cancel, and recovery from errors.
3. Evidence citations visible and clickable; uncited claims flagged.
4. Edit, version history, regenerate with options, delete.
5. Exports that work and look professional.

## Tasks
1. **Documents library** (`/documents`): list/grid with type filter, search, sort, empty state,
   quota/usage meter (`/me/usage`), "New document" menu.
2. **Creation flows** (`/documents/new/resume|appraisal|promotion` or a stepper per design):
   - Resume: date range (`DateRangePicker`), role (backend/frontend/fullstack/devops/manager),
     tone/length options, target job description (optional textarea, if contract supports).
   - Appraisal: period type + month/quarter/year picker, optional self-reflection notes.
   - Promotion: current role, target role, optional ladder/expectations text.
   - Preview of the evidence that will be used ("23 PRs, 4 repos, 3 achievements") before generating.
3. **Streaming viewer**: consume SSE via `useEventSource`; render sections progressively with a
   typing/skeleton treatment; cancel button; on error show retry with the error code message;
   on reconnect resume or re-fetch the saved document.
4. **Viewer/editor** (`/documents/:id`): structured rendering per type (`DocumentPreview` rebuilt),
   inline editing (rich text or structured fields per section; Tiptap or simple Markdown editor —
   choose per design), autosave → `PATCH` (new version), version history drawer with restore,
   regenerate (whole doc or a section, if API supports), citation chips (`PR-123`) opening a
   popover with the PR/commit details and GitHub link; warning badges for uncited/invalid claims.
5. **Exports**: Copy (plain text + Markdown), Download Markdown, **PDF** and **DOCX** using the
   ADR-chosen renderer (likely API endpoints `GET /documents/:id/export?format=pdf|docx|md`).
   Professional templates per type (resume bullets section ready to paste; appraisal report with
   headings and metrics table; promotion packet with sections). Filenames include type + period.
6. Resume bullet cards (`ResumeBulletCard` rebuilt): category badge, copy single bullet, pin/
   reorder, mark as "used".
7. Handle quota exceeded / rate limited with upgrade or wait messaging per design.
8. Tests: component tests for streaming states (mock SSE), editor autosave/versioning, export
   button behaviour; API tests for export endpoints (valid PDF/DOCX produced — check magic bytes
   and that text content contains key sections); Playwright E2E: create resume (mocked AI stream
   in test env) → edit a bullet → version saved → export DOCX/PDF download succeeds → appears in
   library → delete.
9. Remove the v0.1.0 `/resume`, `/appraisal`, `/promotion` implementations (keep redirects to the
   new routes if URLs change).
10. Screenshots to `docs/v2/screenshots/p11/`.

## Deliverables
Documents library, three creation flows, streaming viewer, editor with versions and citations,
export endpoints + templates, tests, screenshots, PROGRESS.md.

## Acceptance criteria
- [ ] All three document types can be generated, streamed, edited, versioned, exported (MD, PDF, DOCX) and deleted (E2E).
- [ ] Every button in the studio has a working handler (no dead buttons; reviewed against SCREENS.md).
- [ ] Citations render and resolve; invalid/uncited claims are visibly flagged.
- [ ] Navigating away mid-stream and back shows the document (saved or in progress), never a lost result.
- [ ] Exported PDF/DOCX open correctly (magic-byte + content tests) and match the template screenshots.
- [ ] Quota/rate-limit errors show designed messaging.
- [ ] Mobile 390px usable; axe 0 serious/critical; `npm run check` + CI green.

## Handoff
Note editor choice, export renderer details, and any generator/API improvements to feed back to P08 follow-ups.
