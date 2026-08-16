import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../supabase.server";
import { getShopSettings, saveShopSettings } from "../lib/diamonds.server";
import {
  LINE_ITEM_FIELDS,
  MAX_RING_SIZES,
  RING_SIZE_PRESETS,
  normalizeRingSizes,
} from "../lib/money";

const ALL_SHAPES = ["emerald", "round", "oval", "princess", "cushion", "pear"];

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabase();

  const settings = await getShopSettings(session.shop);
  const { data } = await supabase
    .from("diamond_prices")
    .select("shape")
    .eq("shop", session.shop);
  const liveShapes = [...new Set((data || []).map((r) => r.shape))];

  return { settings, liveShapes, presets: RING_SIZE_PRESETS };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  let fields;
  let sizes;
  try {
    fields = JSON.parse(fd.get("lineItemFields") || "[]");
    sizes = JSON.parse(fd.get("ringSizes") || "[]");
  } catch {
    return { ok: false, message: "Bad settings payload." };
  }
  try {
    await saveShopSettings(session.shop, {
      lineItemFields: fields,
      ringSizes: normalizeRingSizes(sizes),
    });
  } catch (err) {
    return { ok: false, message: `Save failed: ${err.message}` };
  }
  return { ok: true, message: "Settings saved." };
};

export default function Settings() {
  const { settings, liveShapes, presets } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const res = fetcher.data;

  const [fields, setFields] = useState(new Set(settings.lineItemFields));
  const [sizes, setSizes] = useState(settings.ringSizes);
  const [newSize, setNewSize] = useState("");
  const [editing, setEditing] = useState(null); // index being renamed
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (res?.ok) setDirty(false); }, [res]);

  function toggle(key) {
    setFields((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setDirty(true);
  }

  // ---- ring sizes ---------------------------------------------------------
  function commitSizes(next) {
    setSizes(next);
    setDirty(true);
  }
  // One field accepts several at once — pasting "3, 3.5, 4" beats 20 clicks.
  function addSizes(text) {
    const additions = String(text).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!additions.length) return;
    const lower = new Set(sizes.map((s) => s.toLowerCase()));
    const fresh = additions.filter((s) => !lower.has(s.toLowerCase()));
    if (fresh.length) commitSizes([...sizes, ...fresh].slice(0, MAX_RING_SIZES));
    setNewSize("");
  }
  function removeSize(i) { commitSizes(sizes.filter((_, n) => n !== i)); }
  function renameSize(i, value) {
    const v = value.trim();
    if (!v) return;
    if (sizes.some((s, n) => n !== i && s.toLowerCase() === v.toLowerCase())) return;
    commitSizes(sizes.map((s, n) => (n === i ? v : s)));
  }
  function moveSize(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= sizes.length) return;
    const next = sizes.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commitSizes(next);
  }
  // Not named usePreset* — the `use` prefix makes lint treat it as a React hook.
  function applyPreset(key) {
    const p = presets.find((x) => x.key === key);
    if (p) commitSizes(p.sizes);
  }

  function save() {
    fetcher.submit(
      { lineItemFields: JSON.stringify([...fields]), ringSizes: JSON.stringify(sizes) },
      { method: "post" },
    );
  }
  function discard() {
    setFields(new Set(settings.lineItemFields));
    setSizes(settings.ringSizes);
    setEditing(null);
    setDirty(false);
  }

  return (
    <div>
      <SaveBar id="settings-save" open={dirty}>
        <button variant="primary" onClick={save} {...(busy ? { loading: "" } : {})}>Save</button>
        <button onClick={discard}>Discard</button>
      </SaveBar>

      <div className="page-head">
        <h2>Selector settings</h2>
        <p>Control what carries into the order and see how the selector is set up. No code required.</p>
      </div>

      <div className="card">
        <h3>Order line items</h3>
        <p className="desc">Which specs are written to cart, checkout, order confirmation and packing slip. Shape is always included.</p>
        <div className="chips">
          {LINE_ITEM_FIELDS.map((f) => (
            <span key={f.key}
              className={"mini" + (fields.has(f.key) ? " on" : "")}
              onClick={() => toggle(f.key)}>
              {f.label}
            </span>
          ))}
        </div>
        {res && <div className={"flash " + (res.ok ? "ok" : "err")} style={{ marginTop: 14 }}>{res.message}</div>}
      </div>

      <div className="card">
        <h3>Selection flow</h3>
        <p className="desc">The order is fixed: origin → carat → colour → clarity → ring size. Only valid combinations are ever shown, and the live total is ring base + selected stone.</p>
        <div className="cfg-row">
          <div className="txt"><b>Diamond origin</b><p>Natural / Lab is the first choice, loading the correct price set.</p></div>
          <div className="toggle on" style={{ pointerEvents: "none" }} />
        </div>
        <div className="cfg-row">
          <div className="txt" style={{ width: "100%" }}>
            <b>Ring size</b>
            <p>
              The sizes shoppers can choose, in the order shown. No price impact.
              Click a size to rename it, or use the arrows to reorder.
            </p>

            <div className="sz-list">
              {sizes.map((s, i) => (
                <span className="sz" key={`${s}-${i}`}>
                  {editing === i ? (
                    <input
                      className="sz-edit"
                      /* Focus on mount rather than autoFocus, which lint flags.
                         The input is uncontrolled, so typing causes no re-render
                         and the caret is never yanked back. */
                      ref={(el) => el && el.focus()}
                      defaultValue={s}
                      onBlur={(e) => { renameSize(i, e.target.value); setEditing(null); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { renameSize(i, e.target.value); setEditing(null); }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="sz-name" onClick={() => setEditing(i)} title="Rename">{s}</button>
                  )}
                  <button type="button" className="sz-mv" onClick={() => moveSize(i, -1)} disabled={i === 0} aria-label={`Move ${s} earlier`}>‹</button>
                  <button type="button" className="sz-mv" onClick={() => moveSize(i, 1)} disabled={i === sizes.length - 1} aria-label={`Move ${s} later`}>›</button>
                  <button type="button" className="sz-x" onClick={() => removeSize(i)} aria-label={`Remove ${s}`}>×</button>
                </span>
              ))}
              {!sizes.length && <span className="muted">No sizes — add one below, or pick a preset.</span>}
            </div>

            <div className="sz-add">
              <input
                className="ds-field"
                placeholder="Add a size — or several: 3, 3.5, 4"
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSizes(newSize); } }}
              />
              <button type="button" className="btn ghost" onClick={() => addSizes(newSize)} disabled={!newSize.trim()}>Add</button>
            </div>

            <div className="sz-presets">
              <span className="muted">Replace with:</span>
              {presets.map((p) => (
                <button type="button" key={p.key} className="mini" onClick={() => applyPreset(p.key)}>{p.label}</button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              {sizes.length} size{sizes.length === 1 ? "" : "s"} · maximum {MAX_RING_SIZES}.
              Removing a size only affects new orders — sizes already on an order are unchanged.
            </p>
          </div>
        </div>
        <div className="cfg-row">
          <div className="txt"><b>Live price total</b><p>Updates as each choice is made.</p></div>
          <div className="toggle on" style={{ pointerEvents: "none" }} />
        </div>
        <p className="muted" style={{ marginTop: 12 }}>Heading, labels and the ring visual are controlled per page in the theme editor block settings.</p>
      </div>

      <div className="card">
        <h3>Launch shapes</h3>
        <p className="desc">A shape goes live as soon as its rows appear in your price sheet — no rebuild. Highlighted shapes have prices loaded.</p>
        <div className="chips">
          {ALL_SHAPES.map((s) => (
            <span key={s} className={"mini readonly" + (liveShapes.includes(s) ? " on" : "")}>
              {s.charAt(0).toUpperCase() + s.slice(1)}{liveShapes.includes(s) ? " ✓" : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
