// Pure helpers — NO server imports. Safe to import into client components.
// (Server-only logic that touches Supabase/Admin lives in diamonds.server.js.)

// ---------------------------------------------------------------------------
//  Money — everything internal is integer pence. Never use floats for money.
// ---------------------------------------------------------------------------
export function poundsToPence(pounds) {
  const n =
    typeof pounds === "number"
      ? pounds
      : parseFloat(String(pounds).replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function penceToPoundsString(pence) {
  return (pence / 100).toFixed(2); // "1200.00" — safe for Shopify variant price
}

export function formatGBP(pence) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

// ---------------------------------------------------------------------------
//  Ring sizes — merchant-managed per shop (Selector settings). No price impact.
//
//  This function is only the fallback for a shop that has never edited the list;
//  the live list comes from getRingSizes() in diamonds.server.js. Anything that
//  validates a size MUST use the shop's list, not this one, or a merchant who
//  switches to US sizes gets "invalid_size" on every add to cart.
// ---------------------------------------------------------------------------
export function ringSizes() {
  const letters = "HIJKLMNOPQ".split("");
  const out = [];
  letters.forEach((l, i) => {
    out.push(l);
    if (i < letters.length - 1) out.push(l + ".5");
  });
  return out; // H, H.5, I, I.5 … P, P.5, Q
}

// Ready-made lists offered as one-click presets in the admin.
export const RING_SIZE_PRESETS = [
  { key: "uk", label: "UK (H–Q)", sizes: ringSizes() },
  {
    key: "us",
    label: "US (3–13)",
    sizes: Array.from({ length: 21 }, (_, i) => {
      const n = 3 + i * 0.5;
      return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }),
  },
  {
    key: "eu",
    label: "EU (44–70)",
    sizes: Array.from({ length: 27 }, (_, i) => String(44 + i)),
  },
];

export const MAX_RING_SIZES = 120;
const MAX_SIZE_LABEL = 12;

/**
 * Clean a merchant-supplied size list. Order is preserved — it is the order
 * shoppers see — so this de-duplicates rather than sorting. Falls back to the
 * default list only when nothing usable survives, so a shop can never end up
 * with an empty size control.
 */
export function normalizeRingSizes(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "").split(/[,\n]/);

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const s = String(item ?? "").trim().slice(0, MAX_SIZE_LABEL);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_RING_SIZES) break;
  }
  return out.length ? out : ringSizes();
}

// ---------------------------------------------------------------------------
//  Normalisers — keep CSV / storefront input consistent with stored rows.
// ---------------------------------------------------------------------------
export function normOrigin(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["natural", "nat", "n"].includes(s)) return "natural";
  if (["lab", "lab grown", "lab-grown", "labgrown", "l"].includes(s)) return "lab";
  return null;
}
export function normCarat(v) {
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : null; // "1.00"
}
export function normColour(v) {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z]$/.test(s) ? s : null;
}
export function normClarity(v) {
  return String(v || "").trim().toUpperCase().replace(/\s+/g, "") || null;
}

// ---------------------------------------------------------------------------
//  Combo key — identifies a dynamic variant. Includes total price so a monthly
//  price change mints a fresh variant and never mutates an existing one.
// ---------------------------------------------------------------------------
export function comboKey({ shape, origin, carat, colour, clarity, totalPence }) {
  return [shape, origin, carat, colour, clarity, totalPence].join(":");
}

// ---------------------------------------------------------------------------
//  Which spec fields can be written to the order line items (Selector settings).
// ---------------------------------------------------------------------------
export const LINE_ITEM_FIELDS = [
  { key: "diamond", label: "Diamond (Natural/Lab)" },
  { key: "carat", label: "Carat" },
  { key: "colour", label: "Colour" },
  { key: "clarity", label: "Clarity" },
  { key: "size", label: "Ring size" },
  { key: "stone_price", label: "Diamond price" },
];
export const DEFAULT_LINE_ITEM_FIELDS = ["diamond", "carat", "colour", "clarity", "size", "stone_price"];
