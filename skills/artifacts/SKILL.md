---
name: artifacts
description: "Create, update and share rendered artifacts with the `artifacts` MCP server (https://artifacts.m64.sh/mcp). Use it when the output is a deliverable that the user will view, reuse or change outside the chat. Deliverables: HTML page or report, React app or dashboard, slide deck, UI mockup or prototype, motion graphic. Also: Mermaid or SVG diagram, long Markdown document, standalone code sample. Also use it to revise, share or keep an artifact. It gives the theme tokens, house style and checks that make all artifacts look the same in light and dark mode. Do not use it for short answers, explanations, snippets of about 15 lines or fewer, or files that belong in a repository."
---

# Artifacts

The `artifacts` MCP server stores a document, renders it in a sandbox, keeps versions and gives a link.
Read `references/types.md` for the recipe and the limits of the type that you use.

## Workflow rules

1. Create an artifact only for complete, standalone output that the user will view, reuse or change.
2. Do not create one for short answers, explanations or snippets of about 15 lines or fewer.
3. Write files that belong to a repository in the repository. Publish a copy only when the user must see it rendered.
4. One deliverable is one artifact. To revise it, call `update_artifact` with the same `id`. Do not create a new artifact for each revision.
5. Ask before you create more than one artifact in one turn. Never upload many files or a repository.
6. After a create or an update, give the `url` as a Markdown link and a one-line summary. Do not paste the content again.
7. Never put secrets, credentials, tokens or private data in an artifact.
8. Do not call `share_artifact` or `set_artifact_retention` unless the user asks. An artifact expires 30 days after its last content change.
9. A subagent does not publish artifacts. It returns the content, and the parent publishes it.
10. If the server is not available, write the file locally, open it, and give the user the path.

In pi, call the server through `mcp`. If your client exposes the tools directly (for example `artifacts_create_artifact`), call them directly.

```js
mcp({ server: "artifacts", tool: "create_artifact", args: { title: "Q3 signups", type: "react", content: "..." } })
```

| Tool | Use |
|---|---|
| `create_artifact` | `title` (1-200 characters), `type`, `content` (not empty, 1 MiB maximum), `language` (only for `code`) |
| `update_artifact` | `old_str` + `new_str` for a small edit. `old_str` must occur exactly once. `content` replaces all. `title` alone renames without a new version. |
| `get_artifact`, `list_artifacts` | Read the latest content (or a `version`) before you edit an artifact that you did not write in this session. |
| `share_artifact`, `unshare_artifact`, `set_artifact_retention`, `delete_artifact` | Only on request. `delete_artifact` cannot be undone. |

## Choose the type

| The user needs | Type |
|---|---|
| A report, landing page or tool in plain HTML, CSS and JS | `html` |
| An interactive app, a dashboard with charts, or state-heavy UI | `react` (put the data in the file) |
| A presentation | `slides` |
| UI screens, a mockup, a flow or a clickable prototype | `design` |
| An animated explainer or a motion graphic | `motion` |
| A flowchart, sequence, state, ER or Gantt diagram | `mermaid` |
| An icon, a logo or an illustration | `svg` |
| A document, guide, spec or written report | `markdown` |
| A standalone source file | `code` with `language` |

## Theme contract

The renderer adds these CSS variables to `:root` in every document, in a low-priority cascade layer. Your CSS always wins over them.

| Token | Use it for |
|---|---|
| `--bg` | Page background |
| `--surface`, `--surface-2` | Cards and panels, then nested or hovered surfaces |
| `--border` | Borders and dividers |
| `--fg` | Body text and headings |
| `--muted` | Secondary text and metadata, not body text |
| `--accent`, `--on-accent` | The primary action, links, focus rings, one highlight. `--on-accent` is text on `--accent`. |
| `--danger`, `--warning`, `--success`, `--info` | Status. Always add text or an icon. |
| `--chart-1` ... `--chart-6` | Data series, in this order |
| `--font`, `--mono` | UI text. Code and tabular numbers. |
| `--radius`, `--shadow` | Corner radius. The one shadow for floating layers, such as menus. |

The palette is Gruvbox. Light: `--bg` #fbf1c7, `--fg` #3c3836, `--accent` #af3a03. Dark: `--bg` #282828, `--fg` #ebdbb2, `--accent` #d79921.

- The tokens follow the System, Light or Dark choice of the viewer in the app. Outside the app (a new tab or an export), they follow the operating system. The print view is always light.
- The renderer sets `data-theme="light"` or `data-theme="dark"` on `<html>`. For dark-only CSS, use `:root[data-theme=dark]`. Do not use `@media (prefers-color-scheme)`, because it follows only the operating system.
- If you set `data-theme` on `<html>` yourself (for example for daisyUI), the renderer keeps your value. Then the tokens follow your value, not the viewer.
- When the theme changes, `window` gets an `artifact-theme` event. Its `detail` is `'light'` or `'dark'`. Use it to redraw canvas and chart code that reads colors once.
- In `react` and `design`, Tailwind has these colors: `bg-bg`, `bg-surface`, `bg-surface-2`, `border-border`, `text-fg`, `text-muted`, `bg-accent`, `text-on-accent`, `text-danger`, `text-warning`, `text-success`, `text-info`, `chart-1` to `chart-6` (for example `fill-chart-1`, `stroke-chart-2`). `font-sans` and `font-mono` use the font tokens. The `dark:` variant follows `data-theme`.
- The renderer themes `markdown`, `code`, `mermaid`, `slides` and the canvas around `design` and `mermaid`.
- For `html`, `react` and `motion`, the renderer does not set the background, the text color or `color-scheme`. Set `background: var(--bg)` and `color: var(--fg)` yourself. You can also set `color-scheme`.
- A `design` artboard is white by default, as a blank screen. Put `bg-bg text-fg` on each artboard to use the theme.
- SVG presentation attributes accept tokens: `fill="var(--chart-1)"`. This also works in Recharts props.

Minimal `html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q3 report</title>
<style>
  :root { color-scheme: light; }
  :root[data-theme=dark] { color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 var(--font); }
  main { max-width: 760px; margin: 0 auto; padding: 24px 20px 48px; display: grid; gap: 16px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
           padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  h1 { font-size: 18px; margin: 0; }
  .meta { color: var(--muted); font-size: 13px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; }
  a { color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <header><h1>Q3 report</h1><span class="meta">Updated 11 Oct 2026</span></header>
  <section class="card">...</section>
</main>
</body>
</html>
```

Minimal `react`:

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const data = [{ month: 'Jul', signups: 120 }, { month: 'Aug', signups: 164 }, { month: 'Sep', signups: 151 }];

export default function Signups() {
  return (
    <div className="min-h-dvh bg-bg text-fg font-sans text-[15px]">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <h1 className="font-semibold">Signups</h1>
        <span className="text-[13px] text-muted">Jul to Sep 2026</span>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <section className="h-72 rounded-[var(--radius)] border border-border bg-surface p-4" aria-label="Monthly signups, bar chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="month" stroke="var(--muted)" />
              <YAxis stroke="var(--muted)" />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
              <Bar dataKey="signups" name="Signups" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </main>
    </div>
  );
}
```

Canvas or chart code that needs real color values. In `html` and `motion`, the theme loads after your content, so a value read while the page loads can be empty. The `artifact-theme` event also fires once at the start, so this pattern gets the correct values:

```js
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function draw() { ctx.fillStyle = token('--chart-1'); /* ... */ }
draw();
addEventListener('artifact-theme', draw);
```

Sandbox limits: the document has an opaque origin and no access to the app. `localStorage`, `sessionStorage` and cookies fail or do not persist, so keep state in memory. `fetch` works only for URLs that send CORS headers.

## House style

Make every artifact minimal and calm, in the style of Claude's own UI.

- Use slim header rows (40-48px high), 14-15px UI text and 13px metadata.
- Use generous whitespace on a 4px or 8px scale.
- Use the accent color sparingly: the one primary action, links, focus and one highlight.
- Put secondary actions in one menu, not in a row of buttons.
- Use an icon-only toggle only when its meaning is clear. Give it an `aria-label`.
- Use `--radius` corners and 1px `--border` lines. Use `--shadow` only on floating layers.
- Use tokens for all colors. Do not hard-code a light palette.

## Design rules, most important first

1. **Contrast.** Body text needs 4.5:1. Large text, icons and chart marks need 3:1. Check both themes.
2. **Keyboard.** Every control is a real `button`, `a` or form element with a visible `:focus-visible` ring. The tab order follows the visual order.
3. **Small screens.** At 375px width there is no horizontal scroll. Stack columns and let wide tables scroll inside their own container.
4. **Type and spacing.** Use few sizes (13, 15, 18, 24px), line height 1.5-1.6, 60-75 characters per line, `font-variant-numeric: tabular-nums` for numbers.
5. **Icons.** Use inline SVG icons from one set (Lucide style, 1.5-2px stroke). Do not use emoji as icons.
6. **Motion.** Animate only `transform` and `opacity`, for 150-300ms. Respect `prefers-reduced-motion`.
7. **Charts.** Show a legend or direct labels, axis units and a short text summary. Do not use color as the only signal.
8. **States and forms.** Show empty, loading and error states. Give every input a visible label. Show each error below its field.

## Before you publish

- [ ] The page sets `--bg` and `--fg` (or `bg-bg text-fg`) when the type is `html`, `react` or `motion`.
- [ ] It is readable and complete with `data-theme="light"` and with `data-theme="dark"`.
- [ ] No hard-coded light palette and no `prefers-color-scheme` queries remain.
- [ ] Nothing overflows at 375px width (does not apply to `slides` and `design` artboards).
- [ ] Text contrast is 4.5:1 or more in both themes.
- [ ] There are no secrets, tokens or private data in the content.
- [ ] A revision uses `update_artifact` on the same `id`.
