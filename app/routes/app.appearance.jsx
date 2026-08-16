import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../supabase.server";
import { getAppearance, saveAppearance } from "../lib/diamonds.server";
import { normCarat, normColour, normClarity, ringSizes } from "../lib/money";
import {
  APPEARANCE_DEFAULTS,
  CHIP_SHAPES,
  CHIP_SIZES,
  COLOUR_FIELDS,
  CONTROL_STYLES,
  HEADING_FONTS,
  LAYOUTS,
  STEPS,
  appearanceVars,
  normalizeAppearance,
  scopeCustomCss,
  varsToCssText,
} from "../lib/appearance";
import { SAMPLE_DATA, buildPreviewBody } from "../lib/preview-markup";

// The real storefront stylesheet, read off disk by a Vite plugin and inlined at
// build time. Importing it rather than keeping a copy is the whole point: the
// preview cannot fall out of date with what shoppers actually see. It comes
// through a virtual module rather than a direct path because `shopify app dev`
// reserves /extensions/* for the theme-extension server — see vite.config.js.
import storefrontCss from "virtual:crc-storefront-css";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabase();

  // Preview against the merchant's own carats and colours where we have them,
  // so they judge the design on real data rather than invented values.
  const { data } = await supabase
    .from("diamond_prices")
    .select("origin, carat, colour, clarity")
    .eq("shop", session.shop)
    .limit(2000);

  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const rows = data || [];
  const preview = rows.length
    ? {
        origins: uniq(rows.map((r) => String(r.origin || "").toLowerCase())).filter((o) =>
          ["natural", "lab"].includes(o),
        ),
        carats: uniq(rows.map((r) => normCarat(r.carat))).sort((a, b) => parseFloat(a) - parseFloat(b)),
        colours: uniq(rows.map((r) => normColour(r.colour))).sort(),
        clarities: uniq(rows.map((r) => normClarity(r.clarity))).sort(),
        sizes: ringSizes(),
      }
    : SAMPLE_DATA;

  // storefrontCss is deliberately NOT returned here — it is inlined into the
  // route bundle by the ?raw import, so shipping it through the loader as well
  // would send the same 12KB down on every navigation.
  return {
    appearance: await getAppearance(session.shop),
    preview,
    usingRealData: rows.length > 0,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  let payload;
  try {
    payload = JSON.parse(fd.get("appearance") || "{}");
  } catch {
    return { ok: false, message: "Bad appearance payload." };
  }
  try {
    await saveAppearance(session.shop, payload);
  } catch (err) {
    return { ok: false, message: `Save failed: ${err.message}` };
  }
  return { ok: true, message: "Appearance saved. Refresh a ring page to see it live." };
};

const PREVIEW_WIDTHS = [
  { value: "desktop", label: "Desktop", width: "100%" },
  { value: "mobile", label: "Mobile", width: "390px" },
];

/* eslint-disable react/prop-types -- local presentational helper, not exported */
function Segmented({ options, value, onChange, name }) {
  return (
    <div className="ap-seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={"ap-seg__btn" + (value === o.value ? " is-active" : "")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
/* eslint-enable react/prop-types */

export default function Appearance() {
  const { appearance, preview, usingRealData } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const res = fetcher.data;

  const [form, setForm] = useState(() => normalizeAppearance(appearance));
  const [dirty, setDirty] = useState(false);
  const [device, setDevice] = useState("desktop");

  useEffect(() => { if (res?.ok) setDirty(false); }, [res]);

  function set(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }
  function setStepStyle(key, value) {
    setForm((prev) => ({ ...prev, stepStyles: { ...prev.stepStyles, [key]: value } }));
    setDirty(true);
  }
  function save() {
    fetcher.submit({ appearance: JSON.stringify(form) }, { method: "post" });
  }
  function discard() {
    setForm(normalizeAppearance(appearance));
    setDirty(false);
  }
  function resetDefaults() {
    setForm({ ...APPEARANCE_DEFAULTS, stepStyles: { ...APPEARANCE_DEFAULTS.stepStyles } });
    setDirty(true);
  }

  // Rebuilt on every keystroke — it is all string concatenation, no network.
  const srcDoc = useMemo(() => {
    const a = normalizeAppearance(form);
    return `<!doctype html><html><head><meta charset="utf-8">
<style>${storefrontCss}</style>
<style>.crc-ds{${varsToCssText(appearanceVars(a))}}</style>
<style>${scopeCustomCss(a.customCss)}</style>
<style>
  html,body{margin:0;background:#fff}
  body{padding:22px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
  .crc-ds__chip,.crc-ds__cta,.crc-ds__select{pointer-events:none}
  /* Preview-only chrome for the spinner sample. Deliberately NOT in the
     storefront stylesheet — shoppers never see this framing. */
  .crc-ds--sample{margin-top:18px;padding-top:16px;border-top:1px solid #e8e8e8}
  .crc-ds__sample-row{display:flex;align-items:center;gap:12px}
  .crc-ds__sample-label{font-size:12px;color:#8a8a80}
</style>
</head><body>${buildPreviewBody(a, preview)}</body></html>`;
  }, [form, preview]);

  const deviceWidth = PREVIEW_WIDTHS.find((d) => d.value === device)?.width || "100%";

  return (
    <div className="ap-wide">
      <SaveBar id="appearance-save" open={dirty}>
        <button variant="primary" onClick={save} {...(busy ? { loading: "" } : {})}>Save</button>
        <button onClick={discard}>Discard</button>
      </SaveBar>

      <div className="page-head">
        <h2>Appearance</h2>
        <p>Design the selector your shoppers see. Changes preview instantly here and apply to every ring page once saved.</p>
      </div>

      <div className="ap-grid">
        <div className="ap-controls">
          <div className="card">
            <h3>Option controls</h3>
            <p className="desc">
              Pills show every choice at once. Dropdowns stay compact when a step has many
              values — carat and ring size are the usual candidates.
            </p>

            <div className="cfg-row">
              <div className="txt">
                <b>All steps</b>
                <p>The default for every step below.</p>
              </div>
              <Segmented name="Control style" options={CONTROL_STYLES} value={form.controlStyle} onChange={(v) => set({ controlStyle: v })} />
            </div>

            {STEPS.map((s) => (
              <div className="cfg-row" key={s.key}>
                <div className="txt">
                  <b>{s.label}</b>
                  <p>{s.hint}</p>
                </div>
                <Segmented
                  name={s.label}
                  options={[{ value: "", label: "Default" }, ...CONTROL_STYLES]}
                  value={form.stepStyles[s.key]}
                  onChange={(v) => setStepStyle(s.key, v)}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Layout &amp; shape</h3>
            <p className="desc">How the block sits on the product page, and the shape of each option.</p>

            <div className="cfg-row">
              <div className="txt"><b>Block layout</b><p>{LAYOUTS.find((l) => l.value === form.layout)?.hint}</p></div>
              <Segmented name="Layout" options={LAYOUTS} value={form.layout} onChange={(v) => set({ layout: v })} />
            </div>
            <div className="cfg-row">
              <div className="txt"><b>Corner style</b><p>Applies to pills, dropdowns and the button.</p></div>
              <Segmented name="Corner style" options={CHIP_SHAPES} value={form.chipShape} onChange={(v) => set({ chipShape: v })} />
            </div>
            <div className="cfg-row">
              <div className="txt"><b>Option size</b><p>Padding and text size inside each pill.</p></div>
              <Segmented name="Option size" options={CHIP_SIZES} value={form.chipSize} onChange={(v) => set({ chipSize: v })} />
            </div>
            <div className="cfg-row">
              <div className="txt"><b>Equal-width options</b><p>Force every pill to the same width instead of hugging its label.</p></div>
              <button type="button" className={"toggle" + (form.chipFullWidth ? " on" : "")} aria-pressed={form.chipFullWidth}
                onClick={() => set({ chipFullWidth: !form.chipFullWidth })} />
            </div>
            <div className="cfg-row">
              <div className="txt">
                <b>Slide long pill rows</b>
                <p>Keep a long row on one line and scroll it sideways instead of wrapping onto several. Only affects steps shown as pills.</p>
              </div>
              <button type="button" className={"toggle" + (form.pillSlider ? " on" : "")} aria-pressed={form.pillSlider}
                onClick={() => set({ pillSlider: !form.pillSlider })} />
            </div>
            {form.pillSlider && (
              <div className="cfg-row">
                <div className="txt">
                  <b>Start sliding after</b>
                  <p>Rows with more than this many options scroll. Shorter rows just wrap as usual.</p>
                </div>
                <input type="number" min={2} max={50} className="ds-field ap-num" aria-label="Start sliding after"
                  value={form.pillSliderAfter} onChange={(e) => set({ pillSliderAfter: e.target.value })} />
              </div>
            )}
            <div className="cfg-row">
              <div className="txt"><b>Price breakdown</b><p>Show the ring price, diamond price and total above the button.</p></div>
              <button type="button" className={"toggle" + (form.showSummary ? " on" : "")} aria-pressed={form.showSummary}
                onClick={() => set({ showSummary: !form.showSummary })} />
            </div>
            <div className="cfg-row">
              <div className="txt"><b>Heading font</b><p>Used for the total and any headings in the block.</p></div>
              <Segmented name="Heading font" options={HEADING_FONTS} value={form.headingFont} onChange={(v) => set({ headingFont: v })} />
            </div>
          </div>

          <div className="card">
            <h3>Colours</h3>
            <p className="desc">Defaults follow your brand. Every value is a hex colour.</p>
            <div className="ap-colours">
              {COLOUR_FIELDS.map((f) => (
                <label className="ap-colour" key={f.key}>
                  <span className="field-label">{f.label}</span>
                  <div className="ap-colour__row">
                    <input type="color" value={form[f.key]} onChange={(e) => set({ [f.key]: e.target.value })} aria-label={f.label} />
                    <input type="text" value={form[f.key]} spellCheck="false"
                      onChange={(e) => set({ [f.key]: e.target.value })} />
                  </div>
                  {f.help ? <small className="muted">{f.help}</small> : null}
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Custom CSS</h3>
            <p className="desc">
              For anything the controls above don&apos;t cover. Rules are scoped to the selector
              automatically, so a mistake here can&apos;t affect the rest of your page.
            </p>

            <label className="field-label" htmlFor="ap-classes">Extra classes on the block</label>
            <input id="ap-classes" type="text" className="ds-field" spellCheck="false"
              placeholder="my-ring-selector theme-dark"
              value={form.customClasses} onChange={(e) => set({ customClasses: e.target.value })} />
            <p className="muted" style={{ marginTop: 6 }}>
              Space-separated class names, added to the block&apos;s outer element. Letters, numbers, hyphens and underscores only.
            </p>

            <label className="field-label" htmlFor="ap-css" style={{ marginTop: 16 }}>Custom CSS</label>
            <textarea id="ap-css" className="ds-field ap-css" spellCheck="false" rows={10}
              placeholder={".crc-ds__chip { letter-spacing: .04em; }\n.crc-ds__cta { text-transform: none; }"}
              value={form.customCss} onChange={(e) => set({ customCss: e.target.value })} />
            <p className="muted" style={{ marginTop: 6 }}>
              Useful hooks: <code>.crc-ds__chip</code>, <code>.crc-ds__chip.is-active</code>,{" "}
              <code>.crc-ds__select</code>, <code>.crc-ds__summary</code>, <code>.crc-ds__cta</code>,{" "}
              <code>.crc-ds__step</code>.
            </p>

            <button type="button" className="btn ghost" style={{ marginTop: 16 }} onClick={resetDefaults}>
              Reset everything to defaults
            </button>
            {res && <div className={"flash " + (res.ok ? "ok" : "err")} style={{ marginTop: 14 }}>{res.message}</div>}
          </div>
        </div>

        <aside className="ap-preview">
          <div className="card ap-preview__card">
            <div className="ap-preview__head">
              <h3>Live preview</h3>
              <Segmented name="Preview width" options={PREVIEW_WIDTHS} value={device} onChange={setDevice} />
            </div>
            <p className="desc">
              {usingRealData
                ? "Rendered with your own carats, colours and clarities."
                : "Rendered with sample values — upload a price sheet to preview your own."}
            </p>
            <div className="ap-preview__frame" style={{ width: deviceWidth }}>
              <iframe title="Selector preview" srcDoc={srcDoc} sandbox="" />
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Static preview — the real block is interactive and prices update as choices are made.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
