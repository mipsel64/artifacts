# Archify

Use the `archify` artifact type for ten native diagram forms and one-page explainers. Send an Archify candidate through the artifacts MCP: JSON for a native diagram, a Markdown draft for an explainer. The server validates it and runs the real Archify renderer. You do not need the separate Archify skill or its CLI.

## Choose Archify or another type

| The user needs | Type |
|---|---|
| To draw or explore a system, flow, schema, history or timing model with validated structure and an interactive viewer | `archify` with a native `diagram_type` |
| An answer as one page, with the conclusion first and supporting panels | `archify` with `diagram_type: "explainer"` |
| A quick diagram that needs no detailed Archify layout or exploration | `mermaid` |
| An icon, logo, illustration or other hand-authored vector image | `svg` |
| A document, guide, specification or written report | `markdown` |

Use a native diagram when the request names a system, API call, pipeline, schema, history, timing, or everyday steps, parts, relationships or states. Use `explainer` only when the user asks for a page, one page, an explainer, or an answer to share as a page. Do not use Archify for a dashboard; use `react`.

Create Archify artifacts only on request. The upstream proactive `[archify explainer: ...]` modes do not apply.

## Type router

Paths start at the artifacts skill directory.

| Type | Use for | Schema | Example |
|---|---|---|---|
| `architecture` | Components, services, cloud/security boundaries and infrastructure; what an everyday thing contains | `references/archify/schemas/architecture.schema.json` | Systems, services, libraries and CLI repositories: `references/archify/examples/web-app.architecture.json`. Deployment repositories: `references/archify/examples/production-deployment.architecture.json` |
| `workflow` | Processes, approval gates, tool calls, runbooks, CI/CD, plans and step-by-step life processes | `references/archify/schemas/workflow.schema.json` | `references/archify/examples/agent-tool-call.workflow.json` |
| `sequence` | API call chains, request lifecycles, async traces, returns and exchanges between people | `references/archify/schemas/sequence.schema.json` | `references/archify/examples/cache-miss-request.sequence.json` |
| `dataflow` | Pipelines, ETL/ELT, lineage, governance, consumers, and movement of money or documents | `references/archify/schemas/dataflow.schema.json` | `references/archify/examples/product-analytics.dataflow.json` |
| `lifecycle` | State transitions, retries, waiting and terminal states; the status of an application or order | `references/archify/schemas/lifecycle.schema.json` | `references/archify/examples/deployment-release.lifecycle.json` |
| `erd` | Tables, attributes, primary/foreign/unique keys and cardinality | `references/archify/schemas/erd.schema.json` | `references/archify/examples/orders.erd.json` |
| `tree` | Single-parent containment: repository trees, capability breakdowns and organization-style decomposition | `references/archify/schemas/tree.schema.json` | `references/archify/examples/payment-platform.tree.json` |
| `class` | Classes, interfaces, selected members, and dependency, association, inheritance, realization or composition | `references/archify/schemas/class.schema.json` | `references/archify/examples/payments.class.json` |
| `timeline` | Incident reviews, release histories and timestamped events on a proportional clock with source lanes | `references/archify/schemas/timeline.schema.json` | `references/archify/examples/payment-incident.timeline.json` |
| `waterfall` | Span durations, overlap and nesting for one request or agent run on a common time axis | `references/archify/schemas/waterfall.schema.json` | `references/archify/examples/checkout-request.waterfall.json` |
| `explainer` | A conclusion with reasons, scope, diagrams, comparisons, steps, checks and sources on one page | Markdown draft: `references/archify/references/explainer-authoring.md`. JSON form: `references/archify/schemas/explainer.schema.json` | Markdown: the draft in `explainer-authoring.md`. JSON: `references/archify/examples/delivery.explainer.json` |

## Read before you write

1. Read `references/archify/references/authoring-defaults.md`.
2. Read the type schema from the router and `references/archify/schemas/common.schema.json`. Read the relevant schema definition before you use a new field, enum or constrained value. The schemas reject unknown fields.
3. Read the matching example from the router. For Architecture, choose the example that matches the subject. Examples teach shape, not facts or default presentation choices.
4. For an explainer, read `references/archify/references/explainer-authoring.md` completely. It is the complete draft language. Send the draft Markdown as `content`. Use the JSON form only when you need an inline `spec` for a diagram type that has no compact rows (see **Server limits**).
5. Read each selected file completely. If a read truncates content, read the missing range before you write.

Read branch references only when their trigger applies:

- Read `references/archify/references/authoring-contract.md` for a measured field, geometry, legend, language or mode-placement problem.
- Read `references/archify/references/architecture-layout-repair.md` when several connected Architecture routes need one repair.
- Read `references/archify/references/brand-marks.md` only when a real product identity needs a brand mark.
- Read `references/archify/references/viewer-runtime.md` only when the user asks for a specific viewer feature, such as motion, deep links, search or presentation.
- Read `references/archify/renderers/<type>/README.md` for mode-specific layout rules when a diagnostic or the authoring contract points to it.

For a real repository, inspect its entrypoints, runtime boundaries, storage, transports and deployment configuration before you write. Follow each important relationship and condition to its source. Use the inspected facts in the candidate. A citation proves only the fact at that location. Do not treat a startup citation as proof of protocol or persistence behavior. For native diagrams, omit node `sources` and `meta.repository`; both enable repository verification that the server cannot run. See **Server limits**.

## Write the candidate

For a native diagram, write one complete JSON object. Include `schema_version`, `diagram_type` and `meta` as the schema requires. Use the schema version from the matching example and schema. Omit `meta.output`: the server sets it.

Follow these rules for every native diagram:

- Use fresh IDs, wording and layout. Do not copy the example's subject or coordinates.
- Preserve every requested responsibility, relationship direction, protocol and behavior-changing condition. Put approval, authorization and state-transition gates on the affected node or relationship.
- Show the main user journey and necessary branches. Choose the abstraction before placement. Name a deliberately narrow scope in the title.
- Use no node, relationship, source, view, card or boundary count as a target or ceiling.
- Start with automatic routes and endpoint sides. Add explicit routing only for a necessary branch, return, supplied geometry or measured repair. Do not plan coordinates in prose before the complete candidate.
- Set `meta.quality_profile` to `"showcase"` unless the user asks for dense `"standard"`. A dense full-schema ERD can start at `"standard"`; keep every physical field visible.
- Use one primary authored language and set `meta.locale`. Keep product, code, protocol, command, API and environment names exact.
- Omit optional presentation fields unless the request or a measured defect needs them. Examples are finished showcases, not defaults.
- For an everyday subject, keep the native semantic types. Use everyday `icon` values and truthful `meta.legend` labels. Ask for missing personal facts instead of inventing dates, amounts or rules.

For an explainer:

- Write the Markdown draft from `explainer-authoring.md`: a `#` title, the direct conclusion in the first paragraph, at most four reasons in a flat list, then one `##` panel for each question.
- Make every panel support, qualify or apply the conclusion.
- Prefer a diagram when the answer contains relationships, a flow, an exchange, a hierarchy, a history or a data model. Use the compact diagram rows. Use comparisons, steps and checklists for their matching information shapes.
- Keep IDs unique across the document.
- Give measured values their units and sources. Label estimated or illustrative values. Recompute derived values.
- Use the user's language and short, direct sentences.

### Mermaid input

Read Mermaid for topology and meaning. Author fresh Archify JSON. Do not copy Mermaid styling.

| Mermaid input | Archify type and mapping |
|---|---|
| `flowchart` or `graph` | `workflow`; use `architecture` for a component map |
| `sequenceDiagram` | `sequence`; participants become semantic participants and arrows become messages |
| `stateDiagram` | `lifecycle`; retain state and transition meaning |
| `erDiagram` | `erd`; retain entity names, relationship names, keys and cardinality |
| `classDiagram` | `class`; retain type kinds, selected members and relationship kinds |

## Publish

Call `create_artifact` with `type: "archify"` and the complete candidate as `content`:

```js
mcp({
  server: "artifacts",
  tool: "create_artifact",
  args: {
    title: "Checkout request timing",
    type: "archify",
    content: "{\"schema_version\":1,\"diagram_type\":\"waterfall\",...}"
  }
})
```

For an explainer, `content` is the Markdown draft text, starting with its `#` title.

The server validates the candidate, renders it and runs the upstream strict output check. This is the artifacts equivalent of upstream `finalize`, without the browser gate. The server uses your authored quality profile (`meta.quality_profile`, or `@meta quality_profile` in a draft) as the `--quality` value, and `showcase` when you set none. A valid create returns the artifact and its URL.

For a small revision, call `update_artifact` with the same `id`, `old_str` and `new_str`. Edit the candidate, not rendered HTML. `old_str` must match the stored candidate exactly once. This also replaces upstream panel patches for an explainer. Use `get_artifact` first when you did not write the current version in this session.

If publication returns a tool error:

1. Read its diagnostics. Fix `meta.quality_profile` and schema errors before geometry.
2. Edit the connected part named by the diagnostics. Preserve requested meaning, labels, source evidence, and fixed or agreed topology. Keep unrelated geometry that already reads clearly.
3. Call `create_artifact` again if the failed create stored nothing. For an existing artifact, call `update_artifact` with the same `id`.
4. Track each persistent issue by its diagnostic code, subject, stage and evidence. Do not use a lower error count as proof of progress.
5. If an issue survives two focused repairs, inspect the available diagnostic evidence and the relevant contract. For tangled Architecture routes, use the Architecture layout repair reference. Make one evidence-based retry. If the issue remains, report the concrete gap instead of making blind coordinate changes.

Several routes that share nodes need one connected placement repair. Reflow a blocked main path instead of moving unrelated labels. After you move nodes, remove stale generated route overrides so automatic routing can use the new placement.

## Read upstream CLI text

The synced references keep upstream CLI instructions. Translate them to the artifacts workflow as follows:

| Upstream text | Artifacts behavior |
|---|---|
| `finalize` | `create_artifact` for a new artifact, or `update_artifact` for an existing one. Validation and rendering happen in that call. |
| `validate`, `deliver`, strict `check` | Do not run separate commands. The publish call runs validation, rendering and the strict output check. |
| `browser-check`, `visual-check`, capture review | Not available. Do not claim browser evidence, screenshots or visual review. |
| `--out-dir`, `.archify/` folders, receipts and summary sidecars | Do not create them. The artifact and its versions are the stored output. |
| Update awareness and update notices | Not available. Do not invent a notice or install an update. |
| Opening files or `--open` | Give the artifact URL. Do not open a local output file as part of publication. |

Upstream text about `meta.output` does not apply. The server sets the output path itself.

## Server limits

- Repository evidence verification with `--repo-root` is not available. Native `sources` without `meta.repository` fails with `repository-evidence/repository-required`. Valid `meta.repository`, with or without `sources`, then fails with `repository-evidence/root-required`. Their `--repo-root` repair hints do not apply. Omit both fields for native diagrams. In an explainer, do not use `@code` or `@meta repo_url`; web and note sources remain supported. Do not claim repository verification.
- An artifact is one file, so explainer directives that read a sibling file are not available. `@diagram <type> source=...` fails with `explainer/diagram-source-read`, and `@chart data=...` and `@image path=...` have no file to read. Use compact diagram rows, a ```` ```mermaid ```` chart fence with the numbers inline, or a table. For a `dataflow`, `lifecycle`, `class` or `waterfall` diagram inside an explainer, use the JSON explainer form with an inline `spec`, or publish the diagram as its own native artifact and link to it.
- URL brand marks are not available. A string URL fails with `brand/unpinned-url`; its upstream capture hint does not apply. A digest-pinned URL brand fails with `brand/capture-unavailable` because network access is not supported. Built-in catalogue brand IDs work. Otherwise omit `brand`. Do not invent a URL or a visually similar brand.
- Browser and visual checks are not available. Server validation and rendering do not prove visual quality.
- Update notices are not available. The server runs no update checker and emits no update notice.
- The rendered page has a 10 MiB limit. A larger page fails with `archify-output-too-large`. Use fewer or smaller diagrams, or split the content into more than one artifact.
- A strict-check failure without detailed diagnostics comes back as `archify-check` or `archify-check-receipt`. Simplify the part named in the error, or report the gap.

## Theme and viewer

The Archify diagram follows the viewer's System, Light or Dark choice. The artifacts theme tokens and house-style rules do not apply to Archify output. Do not add artifacts CSS to the candidate.

Set an Archify native visual preset in `meta.visual_preset` when the schema permits it and the user requests a style. Set an explainer style with `@meta style=...` in the Markdown draft, or `meta.style` in the JSON form. Omit these fields for the default style. Archify owns its motion and viewer controls.

## Reply

Reply in the user's language. Give a clickable Markdown link to the returned `url` and one line of useful context. Do not paste the candidate.

For a native diagram, state the abstraction level, deliberate omissions, missing source evidence, or illustrative values when they change how the reader should read it. Add a key takeaway only when it helps the user understand a system rather than merely see the requested drawing.

For an explainer, give the conclusion and the page link in two or three lines. Do not paste the draft.

Do not list commands, repair rounds or quality profiles. Do not offer a proactive explainer mode. If the user asks about verification, say that server-side validation and rendering ran but visual review did not.
