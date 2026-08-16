// Pure — builds the live-preview body for the Appearance page.
//
// This mirrors the markup that diamond_selector.liquid renders and that
// diamond-selector.js fills in. Keep the class names and data-attributes in
// step with those two files; the preview's whole value is being honest about
// what a shopper will see. The CSS itself is not duplicated — the preview
// imports the real diamond-selector.css.

import {
  controlStyleFor,
  appearanceRootClasses,
  normalizeAppearance,
  pillsSlide,
} from "./appearance";

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Sample values, used when the shop has no price rows loaded for a shape yet.
export const SAMPLE_DATA = {
  origins: ["natural", "lab"],
  carats: ["0.50", "0.75", "1.00", "1.25", "1.50"],
  colours: ["D", "E", "F", "G", "H"],
  clarities: ["FL", "VVS1", "VVS2", "VS1", "VS2"],
  sizes: ["H", "H.5", "I", "I.5", "J", "J.5", "K", "K.5", "L", "M", "N"],
};

const ORIGIN_LABEL = { natural: "Natural", lab: "Lab Grown" };

function labelFor(step, value) {
  if (step === "origin") return ORIGIN_LABEL[value] || value;
  if (step === "carat") return `${parseFloat(value).toFixed(2)} ct`;
  if (step === "size") return `Size ${value}`;
  return value;
}

function control(appearance, step, values, selected) {
  const style = controlStyleFor(appearance, step);

  if (style === "dropdown") {
    const opts = values
      .map((v) => `<option${v === selected ? " selected" : ""}>${esc(labelFor(step, v))}</option>`)
      .join("");
    return `<div class="crc-ds__control" data-ds-control="${step}">
      <select class="crc-ds__select" data-ds-select>${opts}</select>
    </div>`;
  }

  const chips = values
    .map(
      (v) =>
        `<button type="button" class="crc-ds__chip${v === selected ? " is-active" : ""}">${esc(
          labelFor(step, v),
        )}</button>`,
    )
    .join("");

  // Long rows scroll on one line instead of wrapping. The arrows are inert here
  // (the preview is static), but they show the merchant the row will slide.
  const slide = pillsSlide(appearance, values.length);
  const arrows = slide
    ? `<button type="button" class="crc-ds__arrow crc-ds__arrow--prev" disabled>&#8249;</button>
       <button type="button" class="crc-ds__arrow crc-ds__arrow--next">&#8250;</button>`
    : "";

  return `<div class="crc-ds__control" data-ds-control="${step}">
    <div class="crc-ds__chips${slide ? " is-slider" : ""}" data-ds-chips>${chips}</div>
    ${arrows}
  </div>`;
}

function stepBlock(appearance, { key, name, hint }, values, selected) {
  if (!values.length) return "";
  return `<div class="crc-ds__step" data-ds-step="${key}">
    <div class="crc-ds__step-label">
      <span class="crc-ds__name">${esc(name)}</span>
      <span class="crc-ds__hint">${esc(hint)}</span>
    </div>
    ${control(appearance, key, values, selected)}
  </div>`;
}

/**
 * Body HTML for the preview iframe. `data` comes from the shop's real price
 * rows where available, so a merchant previews their own carats and colours.
 */
export function buildPreviewBody(appearance, data = SAMPLE_DATA, texts = {}) {
  const a = normalizeAppearance(appearance);
  const d = { ...SAMPLE_DATA, ...data };
  const baseLabel = texts.baseLabel || "Ring Price";
  const ctaText = texts.ctaText || "Add to cart";

  const steps = [
    stepBlock(a, { key: "origin", name: "Diamond", hint: "Natural selected" }, d.origins, d.origins[0]),
    stepBlock(a, { key: "carat", name: "Carat", hint: "Weight" }, d.carats, d.carats[Math.min(2, d.carats.length - 1)]),
    stepBlock(a, { key: "colour", name: "Colour", hint: "D is finest" }, d.colours, d.colours[0]),
    stepBlock(a, { key: "clarity", name: "Clarity", hint: "VVS1 is finest" }, d.clarities, d.clarities[1] || d.clarities[0]),
    stepBlock(a, { key: "size", name: "Ring size", hint: "UK" }, d.sizes, d.sizes[4] || d.sizes[0]),
  ].join("");

  // Always the same structure as the block — hiding the price lines is a CSS
  // concern (crc-ds--no-summary), because the CTA lives inside this panel and
  // must survive. Branching the markup here instead would let the preview and
  // the storefront disagree about where the button ends up.
  const summary = `<div class="crc-ds__summary">
    <div class="crc-ds__price-line"><span>${esc(baseLabel)}</span><span class="crc-ds__v">£1,850</span></div>
    <div class="crc-ds__price-line"><span>Selected diamond</span><span class="crc-ds__v">£2,400</span></div>
    <div class="crc-ds__price-line crc-ds__total"><span class="crc-ds__k">Total</span><span class="crc-ds__v">£4,250</span></div>
    <button class="crc-ds__cta">${esc(ctaText)}${a.showSummary ? " · £4,250" : ""}</button>
  </div>`;

  // The real loader covers the whole stage, so showing it in place would hide
  // the preview. It is broken out as a labelled sample instead — the element and
  // class are the genuine ones, so the colour and motion are what shoppers get.
  const loader = `<div class="crc-ds crc-ds--sample">
    <div class="crc-ds__sample-row">
      <span class="crc-ds__spinner"></span>
      <span class="crc-ds__sample-label">While prices load</span>
    </div>
  </div>`;

  return `<div class="crc-ds crc-ds--compact ${esc(appearanceRootClasses(a))}">
    <div class="crc-ds__stage">
      <div class="crc-ds__selector">
        ${steps}
        ${summary}
      </div>
    </div>
  </div>${loader}`;
}
