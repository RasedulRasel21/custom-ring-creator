// Pure helpers — NO server imports. Safe to import into client components.
// Single source of truth for the storefront block's look, shared by three
// places that must never disagree: the Appearance admin page, the live preview
// iframe, and the /proxy/options payload the storefront actually renders from.

export const BRAND = "#22C55E";

// Steps in cascade order. `key` matches data-ds-control="…" in the block.
export const STEPS = [
  { key: "origin", label: "Diamond origin", hint: "Natural / Lab Grown" },
  { key: "carat", label: "Carat", hint: "Stone weight" },
  { key: "colour", label: "Colour", hint: "D is finest" },
  { key: "clarity", label: "Clarity", hint: "VVS1 is finest" },
  { key: "size", label: "Ring size", hint: "No price impact" },
];

export const CONTROL_STYLES = [
  { value: "pills", label: "Pills" },
  { value: "dropdown", label: "Dropdown" },
];

export const LAYOUTS = [
  { value: "stacked", label: "Stacked", hint: "Sits inline with the product form" },
  { value: "card", label: "Card", hint: "Bordered panel with its own shadow" },
];

export const CHIP_SHAPES = [
  { value: "pill", label: "Pill" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
];

export const CHIP_SIZES = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

export const HEADING_FONTS = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "inherit", label: "Theme font" },
];

// Colour knobs, in the order the admin renders them.
export const COLOUR_FIELDS = [
  { key: "accent", label: "Accent", help: "Hover borders, focus rings, links" },
  { key: "lineColor", label: "Borders", help: "Chip and input outlines" },
  { key: "chipActiveBg", label: "Selected chip", help: "Background of the chosen option" },
  { key: "chipActiveText", label: "Selected chip text", help: "" },
  { key: "summaryBg", label: "Price panel", help: "Background behind the totals" },
  { key: "ctaBg", label: "Button", help: "Add to cart background" },
  { key: "ctaText", label: "Button text", help: "" },
  { key: "ctaHoverBg", label: "Button hover", help: "" },
];

export const APPEARANCE_DEFAULTS = {
  // layout
  layout: "stacked",
  controlStyle: "pills",
  stepStyles: { origin: "", carat: "", colour: "", clarity: "", size: "" },
  chipShape: "pill",
  chipSize: "md",
  chipFullWidth: false,
  showSummary: true,
  headingFont: "sans",
  // colour
  accent: BRAND,
  lineColor: "#e4e0d8",
  chipActiveBg: "#1a1a1a",
  chipActiveText: "#ffffff",
  summaryBg: "#ecfdf3",
  ctaBg: "#1a1a1a",
  ctaText: "#ffffff",
  ctaHoverBg: BRAND,
  // escape hatches
  customClasses: "",
  customCss: "",
};

const CSS_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CLASS_LIST = /^[a-z0-9_ -]*$/i;
const MAX_CUSTOM_CSS = 20000;

function pick(value, allowed, fallback) {
  return allowed.some((o) => o.value === value) ? value : fallback;
}
function colour(value, fallback) {
  const s = String(value || "").trim();
  return CSS_COLOUR.test(s) ? s : fallback;
}

// Never trust stored JSON — it survives across app versions and is edited by
// hand in Supabase. Everything gets clamped back to a known-good value.
export function normalizeAppearance(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const d = APPEARANCE_DEFAULTS;

  const stepStyles = {};
  for (const s of STEPS) {
    const v = a.stepStyles?.[s.key];
    stepStyles[s.key] = v === "pills" || v === "dropdown" ? v : "";
  }

  const classes = String(a.customClasses ?? d.customClasses).trim();

  return {
    layout: pick(a.layout, LAYOUTS, d.layout),
    controlStyle: pick(a.controlStyle, CONTROL_STYLES, d.controlStyle),
    stepStyles,
    chipShape: pick(a.chipShape, CHIP_SHAPES, d.chipShape),
    chipSize: pick(a.chipSize, CHIP_SIZES, d.chipSize),
    chipFullWidth: a.chipFullWidth === true,
    showSummary: a.showSummary !== false,
    headingFont: pick(a.headingFont, HEADING_FONTS, d.headingFont),
    accent: colour(a.accent, d.accent),
    lineColor: colour(a.lineColor, d.lineColor),
    chipActiveBg: colour(a.chipActiveBg, d.chipActiveBg),
    chipActiveText: colour(a.chipActiveText, d.chipActiveText),
    summaryBg: colour(a.summaryBg, d.summaryBg),
    ctaBg: colour(a.ctaBg, d.ctaBg),
    ctaText: colour(a.ctaText, d.ctaText),
    ctaHoverBg: colour(a.ctaHoverBg, d.ctaHoverBg),
    // Class attribute, not a selector — reject anything that could break out.
    customClasses: CLASS_LIST.test(classes) ? classes.replace(/\s+/g, " ") : "",
    customCss: String(a.customCss ?? d.customCss).slice(0, MAX_CUSTOM_CSS),
  };
}

// Which control a given step renders as: per-step override wins, else global.
export function controlStyleFor(appearance, stepKey) {
  const a = normalizeAppearance(appearance);
  return a.stepStyles[stepKey] || a.controlStyle;
}

const CHIP_PADDING = { sm: "6px 12px", md: "9px 16px", lg: "12px 20px" };
const CHIP_FONT = { sm: "12px", md: "13px", lg: "14px" };
const CHIP_RADIUS = { pill: "999px", rounded: "6px", square: "0px" };
const FONT_STACK = {
  sans: "var(--ds-sans)",
  serif: "var(--ds-serif)",
  inherit: "inherit",
};

// CSS custom properties the block reads. Keys match the vars in
// diamond-selector.css — adding one here without adding it there is a no-op.
export function appearanceVars(appearance) {
  const a = normalizeAppearance(appearance);
  return {
    "--ds-gold": a.accent,
    "--ds-line": a.lineColor,
    "--ds-chip-radius": CHIP_RADIUS[a.chipShape],
    "--ds-chip-pad": CHIP_PADDING[a.chipSize],
    "--ds-chip-font": CHIP_FONT[a.chipSize],
    "--ds-chip-minw": a.chipFullWidth ? "96px" : "auto",
    "--ds-chip-active-bg": a.chipActiveBg,
    "--ds-chip-active-fg": a.chipActiveText,
    "--ds-summary-bg": a.summaryBg,
    "--ds-cta-bg": a.ctaBg,
    "--ds-cta-fg": a.ctaText,
    "--ds-cta-hover-bg": a.ctaHoverBg,
    "--ds-heading-font": FONT_STACK[a.headingFont],
  };
}

// Classes added to the block root, on top of the base `crc-ds` classes.
export function appearanceRootClasses(appearance) {
  const a = normalizeAppearance(appearance);
  const out = [`crc-ds--layout-${a.layout}`];
  if (!a.showSummary) out.push("crc-ds--no-summary");
  if (a.customClasses) out.push(a.customClasses);
  return out.join(" ");
}

export function varsToCssText(vars) {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

// ---------------------------------------------------------------------------
//  Custom CSS — scoped so a merchant typo can't take down the whole page.
// ---------------------------------------------------------------------------

// Strip comments first: a `{` or `}` inside one would desync the brace walker.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const NESTING_AT_RULES = new Set(["media", "supports", "layer", "container"]);

function scopeRules(css, scope) {
  let out = "";
  let i = 0;
  const n = css.length;

  while (i < n) {
    const start = i;
    let braceAt = -1;
    while (i < n) {
      if (css[i] === "{") { braceAt = i; break; }
      if (css[i] === "}") { i++; break; } // stray closer — drop the fragment
      i++;
    }
    if (braceAt === -1) break; // trailing text with no block; discard

    const prelude = css.slice(start, braceAt).trim();

    // Walk to the matching close brace so nested blocks stay intact.
    let depth = 1;
    let j = braceAt + 1;
    while (j < n && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(braceAt + 1, depth === 0 ? j - 1 : n);
    i = j;

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s({]/)[0].toLowerCase();
      // @media/@supports wrap rules that still need scoping; @keyframes and
      // @font-face contain step selectors and descriptors that must not be.
      out += NESTING_AT_RULES.has(name)
        ? `${prelude}{${scopeRules(body, scope)}}`
        : `${prelude}{${body}}`;
    } else if (prelude) {
      const selector = prelude
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          // `:root { --ds-gold: … }` is the natural way to retheme; map it onto
          // the block itself so the custom properties actually land.
          if (s === ":root" || s === "html" || s === "body") return scope;
          return s.startsWith(scope) ? s : `${scope} ${s}`;
        })
        .join(",");
      if (selector) out += `${selector}{${body}}`;
    }
  }
  return out;
}

/**
 * Everything the storefront needs to paint itself, resolved server-side.
 *
 * The block's JavaScript deliberately does no mapping of its own — it just
 * applies what it is handed. That keeps this file the only place that knows how
 * a setting becomes a colour, a radius or a control type, so the live preview
 * and the real storefront cannot drift apart.
 */
export function appearanceBundle(appearance) {
  const a = normalizeAppearance(appearance);
  const controls = {};
  for (const s of STEPS) controls[s.key] = a.stepStyles[s.key] || a.controlStyle;
  return {
    controls,
    vars: appearanceVars(a),
    rootClasses: appearanceRootClasses(a),
    css: scopeCustomCss(a.customCss),
  };
}

export function scopeCustomCss(css, scope = ".crc-ds") {
  const raw = String(css || "").slice(0, MAX_CUSTOM_CSS);
  if (!raw.trim()) return "";
  // Closing the tag early would let markup escape the <style> element.
  const safe = stripComments(raw).replace(/<\/?(style|script)/gi, "");
  try {
    return scopeRules(safe, scope);
  } catch {
    return "";
  }
}
