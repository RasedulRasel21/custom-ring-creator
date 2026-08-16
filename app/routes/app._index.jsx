import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getSupabase } from "../supabase.server";

// Deep links into the theme editor. A one-click "add this block" link needs the
// theme app extension's UUID, which no Admin API query exposes — so it is read
// from an env var when available (see .env.example) and we fall back to opening
// the product template, where the merchant adds the block by hand.
const BLOCK_HANDLE = "diamond_selector";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabase();
  const shop = session.shop;
  // Read inside the loader, not at module scope: a top-level process.env would
  // only be stripped from the browser bundle if tree-shaking happened to prove
  // it unused, and `process is not defined` there kills hydration silently.
  // eslint-disable-next-line no-undef
  const themeExtensionId = process.env.SHOPIFY_THEME_EXTENSION_ID || "";

  const [prices, pages, images, settingsRow] = await Promise.all([
    supabase.from("diamond_prices").select("shape").eq("shop", shop),
    supabase.from("ring_pages").select("product_id, base_price_pence").eq("shop", shop),
    supabase.from("carat_images").select("carat").eq("shop", shop),
    supabase.from("shop_settings").select("settings").eq("shop", shop).maybeSingle(),
  ]);

  const priceRows = prices.data || [];
  const raw = settingsRow.data?.settings || {};

  return {
    shop,
    themeExtensionId,
    stats: {
      priceRows: priceRows.length,
      shapes: [...new Set(priceRows.map((r) => r.shape).filter(Boolean))],
      basePriced: (pages.data || []).filter((p) => p.base_price_pence != null).length,
      caratImages: (images.data || []).length,
      // Only counts as configured if the merchant actually saved a list —
      // every shop has a working default, so presence is the real signal.
      sizeCount: Array.isArray(raw.ringSizes) ? raw.ringSizes.length : 0,
      styled: !!raw.appearance && Object.keys(raw.appearance).length > 0,
    },
  };
};

/* eslint-disable react/prop-types -- local presentational helper, not exported */
function Step({ n, done, optional, title, children, meta, action }) {
  return (
    <li className={"wl-step" + (done ? " is-done" : "")}>
      <span className="wl-num" aria-hidden="true">{done ? "✓" : n}</span>
      <div className="wl-body">
        <div className="wl-title">
          <b>{title}</b>
          {optional && <span className="wl-tag">Optional</span>}
          {done && <span className="wl-tag is-done">Done</span>}
        </div>
        <p>{children}</p>
        {meta && <p className="wl-meta">{meta}</p>}
      </div>
      <div className="wl-action">{action}</div>
    </li>
  );
}
/* eslint-enable react/prop-types */

export default function Welcome() {
  const { shop, themeExtensionId, stats } = useLoaderData();

  const editor = `https://${shop}/admin/themes/current/editor`;
  // With the UUID we can drop the block straight into the product template;
  // without it, the merchant lands on the right template and adds it manually.
  const addBlockUrl = themeExtensionId
    ? `${editor}?template=product&addAppBlockId=${themeExtensionId}/${BLOCK_HANDLE}&target=mainSection`
    : `${editor}?template=product`;
  const embedUrl = `${editor}?context=apps`;

  const steps = [
    {
      key: "block",
      title: "Add the selector to your ring pages",
      done: false,
      body: themeExtensionId
        ? "Opens your product template with the Diamond Selector block ready to place."
        : "Opens your product template. Choose Add block → Apps → Diamond Selector, then Save.",
      meta: "The app can't detect this automatically — open a ring page to confirm the selector appears.",
      action: <a className="btn" href={addBlockUrl} target="_top" rel="noreferrer">Open theme editor</a>,
    },
    {
      key: "prices",
      title: "Load your diamond prices",
      done: stats.priceRows > 0,
      body: "Upload a monthly CSV, or add stones by hand. A shape goes live as soon as it has prices — nothing to rebuild.",
      meta: stats.priceRows
        ? `${stats.priceRows} price rows across ${stats.shapes.length} shape${stats.shapes.length === 1 ? "" : "s"}: ${stats.shapes.join(", ")}`
        : "No prices yet — the selector will show “No diamond prices are loaded yet.”",
      action: <Link className="btn ghost" to="/app/prices">Price data</Link>,
    },
    {
      key: "rings",
      title: "Set the ring base prices",
      done: stats.basePriced > 0,
      body: "The shopper pays the ring base plus the chosen stone. Without a base price the product's own Shopify price is used.",
      meta: stats.basePriced
        ? `${stats.basePriced} ring page${stats.basePriced === 1 ? "" : "s"} with a base price set`
        : "Falling back to each product's Shopify price.",
      action: <Link className="btn ghost" to="/app/rings">Ring base prices</Link>,
    },
    {
      key: "sizes",
      title: "Choose the ring sizes you offer",
      done: stats.sizeCount > 0,
      body: "Add, rename, reorder or delete sizes, or start from a UK, US or EU preset.",
      meta: stats.sizeCount
        ? `${stats.sizeCount} sizes configured`
        : "Using the built-in UK list (H–Q with half sizes).",
      action: <Link className="btn ghost" to="/app/settings">Selector settings</Link>,
    },
    {
      key: "style",
      title: "Match the selector to your brand",
      done: stats.styled,
      body: "Pills or dropdowns, colours, layout and custom CSS — with a live preview of your own stones.",
      meta: stats.styled ? "Custom appearance saved." : "Using the default appearance.",
      action: <Link className="btn ghost" to="/app/appearance">Appearance</Link>,
    },
    {
      key: "images",
      title: "Show a photo per carat",
      done: stats.caratImages > 0,
      optional: true,
      body: "The product image swaps as the shopper changes carat. Any carat left blank falls back to the product photo.",
      meta: stats.caratImages ? `${stats.caratImages} carat images assigned` : "",
      action: <Link className="btn ghost" to="/app/images">Ring images</Link>,
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const pct = Math.round((done / required.length) * 100);

  return (
    <div className="wl">
      <div className="wl-head">
        <div>
          <h2>Custom Ring Creator</h2>
          <p>
            Shoppers build their own ring — origin, carat, colour, clarity and size — and the
            app prices it live and mints the exact variant at add to cart.
          </p>
        </div>
        <div className="wl-head-actions">
          <a className="btn" href={addBlockUrl} target="_top" rel="noreferrer">Activate block</a>
          <a className="btn ghost" href={embedUrl} target="_top" rel="noreferrer">App embeds</a>
        </div>
      </div>

      <div className="card wl-progress">
        <div className="wl-progress-top">
          <h3>Setup</h3>
          <span className="muted">{done} of {required.length} steps complete</span>
        </div>
        <div className="wl-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>

      <ol className="wl-steps">
        {steps.map((s, i) => (
          <Step key={s.key} n={i + 1} done={s.done} optional={s.optional} title={s.title}
            meta={s.meta} action={s.action}>
            {s.body}
          </Step>
        ))}
      </ol>

      <div className="card">
        <h3>How a sale works</h3>
        <ol className="wl-flow">
          <li><b>The shopper chooses.</b> Only combinations that exist in your price sheet are ever offered.</li>
          <li><b>The app prices it.</b> Every total is calculated server-side from your data — the browser only ever sends the selection.</li>
          <li><b>A variant is minted.</b> On add to cart the app creates a variant at ring base + stone, so the order carries the exact spec and price.</li>
          <li><b>The spec reaches the order.</b> Carat, colour, clarity and size ride along as line item properties, onto the packing slip.</li>
        </ol>
        <p className="muted" style={{ marginTop: 12 }}>
          Raising your prices next month is one CSV upload — past orders keep the price they were sold at.
        </p>
      </div>
    </div>
  );
}
