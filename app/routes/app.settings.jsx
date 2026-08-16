import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import TokenEditor from "../components/TokenEditor";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../supabase.server";
import { getShopSettings, getOriginRowCounts, saveShopSettings } from "../lib/diamonds.server";
import {
  LINE_ITEM_FIELDS,
  MAX_ORIGINS,
  MAX_RING_SIZES,
  RING_SIZE_PRESETS,
  normalizeOrigins,
  normalizeRingSizes,
  originKey,
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

  return {
    settings,
    liveShapes,
    presets: RING_SIZE_PRESETS,
    // Used to warn before deleting an origin that price rows still reference.
    originRows: await getOriginRowCounts(session.shop),
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  let fields;
  let sizes;
  let origins;
  try {
    fields = JSON.parse(fd.get("lineItemFields") || "[]");
    sizes = JSON.parse(fd.get("ringSizes") || "[]");
    origins = JSON.parse(fd.get("origins") || "[]");
  } catch {
    return { ok: false, message: "Bad settings payload." };
  }
  try {
    await saveShopSettings(session.shop, {
      lineItemFields: fields,
      ringSizes: normalizeRingSizes(sizes),
      origins: normalizeOrigins(origins),
    });
  } catch (err) {
    return { ok: false, message: `Save failed: ${err.message}` };
  }
  return { ok: true, message: "Settings saved." };
};

export default function Settings() {
  const { settings, liveShapes, presets, originRows } = useLoaderData();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const res = fetcher.data;

  const [fields, setFields] = useState(new Set(settings.lineItemFields));
  const [sizes, setSizes] = useState(settings.ringSizes);
  const [origins, setOrigins] = useState(settings.origins);
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
  // TokenEditor works in {id,label}; a size is its own identity, so they match.
  const sizeTokens = sizes.map((s) => ({ id: s, label: s }));

  function commitSizes(next) {
    setSizes(next);
    setDirty(true);
  }
  function has(list, v) { return list.some((s) => s.toLowerCase() === v.toLowerCase()); }

  // One field accepts several at once — pasting "3, 3.5, 4" beats 20 clicks.
  function addSizes(text) {
    const fresh = [];
    for (const raw of String(text).split(/[,\s]+/)) {
      const s = raw.trim();
      if (s && !has(sizes, s) && !has(fresh, s)) fresh.push(s);
    }
    if (fresh.length) commitSizes([...sizes, ...fresh].slice(0, MAX_RING_SIZES));
  }
  function removeSize(id) { commitSizes(sizes.filter((s) => s !== id)); }
  function renameSize(id, value) {
    if (value !== id && has(sizes, value)) return; // would collide
    commitSizes(sizes.map((s) => (s === id ? value : s)));
  }
  // Moves `id` into `targetId`'s slot. Direction matters: dropping onto a token
  // further along means landing after it, otherwise the item is re-inserted at
  // the position it already occupied and nothing moves.
  function reorderSize(id, targetId) {
    if (!targetId || id === targetId) return;
    const from = sizes.indexOf(id);
    const to = sizes.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = sizes.filter((s) => s !== id);
    const at = next.indexOf(targetId);
    next.splice(from < to ? at + 1 : at, 0, id);
    commitSizes(next);
  }
  // Not named usePreset* — the `use` prefix makes lint treat it as a React hook.
  function applyPreset(key) {
    const p = presets.find((x) => x.key === key);
    if (p) commitSizes(p.sizes);
  }

  // ---- origins ------------------------------------------------------------
  function commitOrigins(next) {
    setOrigins(next);
    setDirty(true);
  }
  function addOrigin(text) {
    const label = String(text).trim().slice(0, 40);
    const key = originKey(label);
    if (!key || origins.some((o) => o.key === key)) return;
    if (origins.length >= MAX_ORIGINS) return;
    commitOrigins([...origins, { key, label }]);
  }
  // Label only. The key is what diamond_prices.origin stores, so changing it
  // would orphan every price row that references it.
  function renameOrigin(key, label) {
    commitOrigins(origins.map((o) => (o.key === key ? { ...o, label: label.slice(0, 40) } : o)));
  }
  function deleteOrigin(key) {
    const o = origins.find((x) => x.key === key);
    const rows = originRows[key] || 0;
    const warning = rows
      ? `Remove "${o?.label}"? ${rows} price row${rows === 1 ? "" : "s"} use it. ` +
        `The rows are kept — they just stop appearing in the selector, and come back if you re-add this origin.`
      : `Remove "${o?.label}"?`;
    if (!window.confirm(warning)) return;
    commitOrigins(origins.filter((x) => x.key !== key));
  }
  function reorderOrigin(key, targetKey) {
    if (!targetKey || key === targetKey) return;
    const from = origins.findIndex((o) => o.key === key);
    const to = origins.findIndex((o) => o.key === targetKey);
    if (from < 0 || to < 0) return;
    const next = origins.filter((o) => o.key !== key);
    const at = next.findIndex((o) => o.key === targetKey);
    next.splice(from < to ? at + 1 : at, 0, origins[from]);
    commitOrigins(next);
  }

  function save() {
    fetcher.submit(
      {
        lineItemFields: JSON.stringify([...fields]),
        ringSizes: JSON.stringify(sizes),
        origins: JSON.stringify(origins),
      },
      { method: "post" },
    );
  }
  function discard() {
    setFields(new Set(settings.lineItemFields));
    setSizes(settings.ringSizes);
    setOrigins(settings.origins);
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
          <div className="txt" style={{ width: "100%" }}>
            <b>Diamond origin</b>
            <p>
              The first choice a shopper makes; each one loads its own price set.
              Click to rename, drag to reorder. An origin only appears on the storefront
              once its price sheet has rows.
            </p>

            <TokenEditor
              items={origins.map((o) => ({ id: o.key, label: o.label }))}
              onAdd={addOrigin}
              onRename={renameOrigin}
              onDelete={deleteOrigin}
              onReorder={reorderOrigin}
              placeholder="Add an origin — e.g. Moissanite"
            />

            <p className="muted" style={{ marginTop: 8 }}>
              {origins.length} of {MAX_ORIGINS}. Renaming changes only what shoppers see —
              the value stored on your price rows (<code>{origins.map((o) => o.key).join(", ")}</code>)
              never changes, so your CSVs keep working. Deleting hides an origin and its prices
              from the selector but does not delete any price rows.
            </p>
          </div>
        </div>
        <div className="cfg-row">
          <div className="txt" style={{ width: "100%" }}>
            <b>Ring size</b>
            <p>
              The sizes shoppers can choose, in the order shown. No price impact.
              Click a size to rename it, or use the arrows to reorder.
            </p>

            <TokenEditor
              items={sizeTokens}
              onAdd={addSizes}
              onRename={renameSize}
              onDelete={removeSize}
              onReorder={reorderSize}
              placeholder="Add a size — or several: 3, 3.5, 4"
            />

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
