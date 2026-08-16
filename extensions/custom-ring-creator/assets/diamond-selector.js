
/* Custom Ring Creator — storefront cascade + add-to-cart.
   The browser only ever sends the SELECTION. Every price is computed by the
   app server from Supabase and returned; nothing here is authoritative. */
(function () {
  var COLOUR_RANK = { D: 0, E: 1, F: 2, G: 3, H: 4, I: 5, J: 6 };
  var CLARITY_RANK = { FL: 0, IF: 1, VVS1: 2, VVS2: 3, VS1: 4, VS2: 5, SI1: 6, SI2: 7 };

  function rank(map, v) { return v in map ? map[v] : 999; }
  function uniq(arr) { return Array.prototype.filter.call(arr, function (v, i) { return arr.indexOf(v) === i; }); }

  // --- money: convert the app's GBP figures into the visitor's presentment
  // currency (Shopify Markets converts by location) so the selector matches the
  // product page + cart instead of flipping to £. Rate is derived live from the
  // ring base, which the page knows in both currencies. Preview only — the cart
  // and checkout remain authoritative (Shopify applies its own FX + rounding).
  function moneyNum(str) {
    // Pull a numeric value out of a formatted money string ("£1,314.00" -> 1314).
    var s = String(str || "").replace(/[^\d.,]/g, "");
    if (!s) return 0;
    var d = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    var tail = d > -1 ? s.length - d - 1 : 0;
    if (d > -1 && tail >= 1 && tail <= 2) {
      return parseFloat(s.slice(0, d).replace(/[.,]/g, "") + "." + s.slice(d + 1).replace(/[.,]/g, "")) || 0;
    }
    return parseFloat(s.replace(/[.,]/g, "")) || 0;
  }
  function moneyParts(str) {
    // Learn the visitor's money format from a Shopify-rendered string.
    str = String(str || "");
    var core = str.match(/\d[\d.,'’\s]*\d|\d/);
    if (!core) return null;
    var num = core[0];
    var i = str.indexOf(num);
    var dec = num.match(/[.,](\d{1,2})$/);
    var decimals = dec ? dec[1].length : 0;
    var decimalSep = dec ? num.charAt(num.length - decimals - 1) : ".";
    return {
      prefix: str.slice(0, i),
      suffix: str.slice(i + num.length),
      decimals: decimals,
      decimalSep: decimalSep,
      thousandsSep: decimalSep === "," ? "." : ",",
    };
  }
  function fmtMoney(value, p) {
    if (!p) return String(value);
    var neg = value < 0;
    value = Math.abs(Number(value) || 0);
    var fixed = value.toFixed(p.decimals);
    var bits = fixed.split(".");
    var intPart = bits[0].replace(/\B(?=(\d{3})+(?!\d))/g, p.thousandsSep);
    return (neg ? "-" : "") + p.prefix + intPart + (p.decimals ? p.decimalSep + bits[1] : "") + p.suffix;
  }

  function initRoot(root) {
    var productGid = root.getAttribute("data-product-gid");
    var proxyBase = root.getAttribute("data-proxy-base");
    var shape = root.getAttribute("data-shape") || "emerald";
    var thumbSource = root.getAttribute("data-thumb-source") || "carat"; // "carat" | "product"
    var cartType = root.getAttribute("data-cart-type") || "drawer"; // theme native: drawer | page | notification

    // Global show/hide from the "Diamond Selector" app embed (theme settings).
    var globalCfg = window.CustomRingCreator;
    if (globalCfg && globalCfg.show === false) { root.style.display = "none"; return; }

    var q = function (sel) { return root.querySelector(sel); };
    var state = { origin: null, carat: null, colour: null, clarity: null, size: null };
    // Overwritten by applyAppearance before any field is painted; these are the
    // fallbacks used if /options never answers.
    var pillCfg = { slider: true, after: 8 };
    var combos = { natural: [], lab: [] }; // filled from server
    var serverImages = {}; // carat -> url, from options (app mapping + CSV)
    var featuredImage = root.getAttribute("data-featured-image") || "";
    var media = []; // product images with alt text, for the alt-text fallback
    try {
      var mEl = root.querySelector("[data-ds-media]");
      if (mEl) media = JSON.parse(mEl.textContent || "[]");
    } catch (e) { media = []; }

    var el = {
      hintOrigin: q("[data-ds-hint-origin]"),
      base: q("[data-ds-base]"),
      stone: q("[data-ds-stone]"),
      total: q("[data-ds-total]"),
      facet: q("[data-ds-facet]"),
      props: q("[data-ds-props]"),
      cta: q("[data-ds-cta]"),
      msg: q("[data-ds-msg]"),
      image: q("[data-ds-image]"),
      fallback: q("[data-ds-fallback]"),
      thumbs: q("[data-ds-thumbs]"),
    };

    // Currency: the ring base is known in BOTH currencies at load — as presentment
    // minor units (data-base-price, what the visitor sees) and, once a price comes
    // back, in GBP (the app's currency). That ratio is the visitor's FX rate, and
    // el.base's initial text teaches us how to format their currency.
    var presentBaseMinor = parseInt(root.getAttribute("data-base-price") || "0", 10);
    var moneyPat = el.base ? moneyParts(el.base.textContent) : null;
    // Debug: is Shopify exposing a currency object on this theme?
    console.log("[crc-ds] Shopify.currency:", (window.Shopify && window.Shopify.currency) || "(none)");

    // Cache of the REAL FX rate, learned from an actual cart line (see add-to-cart).
    // Keyed by the visitor's active currency so it survives reloads.
    var CUR = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "cur";
    var RATE_KEY = "crc-fxrate:" + CUR;
    function cachedRate() {
      try { var v = parseFloat(localStorage.getItem(RATE_KEY)); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
    }
    function cacheRate(v) {
      try { if (isFinite(v) && v > 0) localStorage.setItem(RATE_KEY, String(v)); } catch (e) { /* ignore */ }
    }

    // Convert the app's GBP figures to the visitor's currency for display.
    function toPresentment(data) {
      var baseGBP = moneyNum(data.baseFormatted);
      var stoneGBP = moneyNum(data.stoneFormatted);
      var presentBase = presentBaseMinor / 100;
      var derived = baseGBP > 0 ? presentBase / baseGBP : 0;
      // No presentment info, or the visitor is already in the store's base
      // currency (rate ~1) — show the app's exact strings, no conversion.
      if (!moneyPat || !isFinite(derived) || derived <= 0 || Math.abs(derived - 1) < 0.01) {
        return { base: data.baseFormatted, stone: data.stoneFormatted, total: data.totalFormatted };
      }
      // Prefer the rate LEARNED from a real cart line over the rate derived from
      // the already-rounded base. Guard against garbage (>10% off).
      var rate = derived;
      var cr = cachedRate();
      if (cr && Math.abs(cr - derived) / derived < 0.1) rate = cr;
      // Every rate we can sample carries rounding noise (each source price is
      // itself rounded to 100). Markets stores use a clean fixed rate, so snap
      // large rates to 1 dp — this recovers e.g. 168.0 from 168.036/167.994 and
      // makes the preview match the cart. Small rates (<10) keep full precision.
      if (rate >= 10) rate = Math.round(rate * 10) / 10;
      // Round to the currency's granularity so we don't show false precision.
      // A whole-hundred base (e.g. BDT) means Shopify rounds to 100 as well.
      var gran = presentBase >= 1000 && presentBase % 100 === 0 ? 100 : 1;
      function r(v) { return gran > 1 ? Math.round(v / gran) * gran : Math.round(v); }
      return {
        base: fmtMoney(r(baseGBP * rate), moneyPat),
        stone: fmtMoney(r(stoneGBP * rate), moneyPat),
        total: fmtMoney(r((baseGBP + stoneGBP) * rate), moneyPat),
      };
    }

    // ---- image resolution: app mapping > CSV > alt-text > featured ------
    function caratNum(v) {
      var n = parseFloat(String(v).replace(/[^\d.]/g, ""));
      return isFinite(n) ? n.toFixed(2) : null;
    }
    function altMatch(carat) {
      for (var i = 0; i < media.length; i++) {
        if (media[i] && caratNum(media[i].alt) === carat) return media[i].src;
      }
      return null;
    }
    function resolveImage(carat) {
      if (!carat) return featuredImage || null;
      return serverImages[carat] || altMatch(carat) || featuredImage || null;
    }
    // Compact block has no image panel of its own — swap the THEME's main product
    // image instead (best-effort; selectors vary by theme). Set both src and
    // srcset so the browser doesn't keep showing the responsive original.
    // Two copies of the same photo compare equal even at different widths: the
    // gallery renders it at one size and the zoom modal at another, so the
    // responsive width/size params have to be ignored to match them up.
    function imageKey(src) {
      if (!src) return null;
      try {
        var u = new URL(src, window.location.href);
        var v = u.searchParams.get("v");
        return u.pathname + (v ? "?v=" + v : "");
      } catch (e) {
        return String(src).split("?")[0];
      }
    }

    function patchImg(el, url) {
      // Drop the responsive srcset/sizes so the browser shows exactly our URL.
      el.removeAttribute("srcset");
      el.removeAttribute("sizes");
      el.removeAttribute("data-srcset");
      el.setAttribute("src", url);
      // Themes that keep the zoom target on the element itself rather than in a modal.
      ["data-zoom-src", "data-large-src", "data-full-src", "data-image"].forEach(function (a) {
        if (el.hasAttribute(a)) el.setAttribute(a, url);
      });
    }

    function swapThemeMedia(url) {
      if (!url) return;
      var sels = [
        ".product-gallery__media img",   // Maestrooo scroll-carousel (this theme)
        "media-gallery img", "product-media img", ".product-media img",
        ".product__media img", "[data-product-media-wrapper] img",
        ".product__media-item img", ".product-single__photo img",
      ];
      var img = null;
      for (var i = 0; i < sels.length && !img; i++) img = document.querySelector(sels[i]);
      if (!img) return;

      // Capture what it was showing BEFORE the swap. The magnifier opens a
      // separate modal holding its own copy of the same media, and matching on
      // the old URL is the only reliable way to find that copy across themes —
      // patching just the gallery left the zoom showing the original photo.
      var key = imageKey(img.getAttribute("src"));
      patchImg(img, url);

      if (key) {
        Array.prototype.forEach.call(document.querySelectorAll("img"), function (other) {
          if (other !== img && imageKey(other.getAttribute("src")) === key) patchImg(other, url);
        });
        // Themes that lightbox by linking straight to the full-size file.
        Array.prototype.forEach.call(document.querySelectorAll("a[href]"), function (a) {
          if (imageKey(a.getAttribute("href")) === key) a.setAttribute("href", url);
        });
      }

      // If it's a scroll carousel, snap back to the (now-swapped) first slide.
      var car = document.querySelector(".product-gallery__carousel, scroll-carousel, .product-gallery__image-list .scroll-area");
      if (car) { try { car.scrollTo({ left: 0, behavior: "smooth" }); } catch (e) { car.scrollLeft = 0; } }
    }
    function setImage(url) {
      if (!el.image) { swapThemeMedia(url); return; }
      if (url) {
        el.image.classList.add("is-swapping");
        var pre = new Image();
        pre.onload = function () {
          el.image.src = url;
          el.image.style.display = "";
          if (el.fallback) el.fallback.style.display = "none";
          el.image.classList.remove("is-swapping");
          updateThumbActive();
        };
        pre.onerror = function () { el.image.classList.remove("is-swapping"); };
        pre.src = url;
      } else {
        el.image.style.display = "none";
        if (el.fallback) el.fallback.style.display = "";
        updateThumbActive();
      }
    }

    function step(name) { return root.querySelector('[data-ds-step="' + name + '"]'); }
    function lock(name) { step(name).classList.add("is-locked"); }
    function unlock(name) { step(name).classList.remove("is-locked"); }

    function showMsg(text, kind) {
      if (!el.msg) return;
      el.msg.textContent = text;
      el.msg.className = "crc-ds__msg " + (kind === "ok" ? "is-ok" : "is-error");
      el.msg.hidden = false;
    }
    function clearMsg() { if (el.msg) el.msg.hidden = true; }

    // ---- fields: one control per step, pills or dropdown ------------------
    // The markup ships both a chip list and a <select> for every step; the
    // merchant's Appearance setting decides which one is populated and shown.
    // Nothing below this line cares which it is.
    function makeField(name, opts) {
      opts = opts || {};
      var wrap = q('[data-ds-control="' + name + '"]');
      if (!wrap) return null;
      var chips = wrap.querySelector("[data-ds-chips]");
      var sel = wrap.querySelector("[data-ds-select]");
      var mode = "dropdown";
      var items = [];
      var value = null;
      var arrows = null;

      function label(v) { return opts.label ? opts.label(v) : v; }

      // ---- slider: keep a long pill row on one line and scroll it ----------
      function updateArrows() {
        if (!arrows) return;
        var max = chips.scrollWidth - chips.clientWidth;
        arrows.prev.disabled = chips.scrollLeft <= 1;
        arrows.next.disabled = chips.scrollLeft >= max - 1;
      }

      function nudge(dir) {
        var by = Math.max(120, Math.round(chips.clientWidth * 0.8));
        try {
          chips.scrollBy({ left: dir * by, behavior: "smooth" });
        } catch (e) {
          chips.scrollLeft += dir * by; // older browsers ignore the options form
        }
      }

      function ensureArrows(on) {
        if (!on) {
          if (arrows) {
            wrap.removeChild(arrows.prev);
            wrap.removeChild(arrows.next);
            arrows = null;
          }
          return;
        }
        if (!arrows) {
          var mk = function (dir, glyph, delta) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "crc-ds__arrow crc-ds__arrow--" + dir;
            b.setAttribute("aria-label", delta < 0 ? "Show earlier options" : "Show more options");
            b.innerHTML = glyph;
            b.addEventListener("click", function () { nudge(delta); });
            wrap.appendChild(b);
            return b;
          };
          arrows = { prev: mk("prev", "&#8249;", -1), next: mk("next", "&#8250;", 1) };
          chips.addEventListener("scroll", updateArrows);
          window.addEventListener("resize", updateArrows);
        }
        updateArrows();
        // Widths are still settling on the first paint (and the block is behind
        // the loading overlay), so re-check once the layout has resolved.
        setTimeout(updateArrows, 0);
      }

      function paint() {
        var dropdown = mode === "dropdown";
        chips.hidden = dropdown;
        sel.hidden = !dropdown;
        if (dropdown) {
          sel.innerHTML = "";
          if (opts.placeholder) {
            var ph = document.createElement("option");
            ph.value = "";
            ph.textContent = opts.placeholder;
            sel.appendChild(ph);
          }
          items.forEach(function (v) {
            var o = document.createElement("option");
            o.value = v;
            o.textContent = label(v);
            sel.appendChild(o);
          });
          sel.value = value == null ? "" : value;
        } else {
          chips.innerHTML = "";
          items.forEach(function (v) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "crc-ds__chip" + (v === value ? " is-active" : "");
            b.setAttribute("data-value", v);
            b.textContent = label(v);
            b.addEventListener("click", function () { set(v, true); });
            chips.appendChild(b);
          });
          var slide = pillCfg.slider && items.length > pillCfg.after;
          chips.classList.toggle("is-slider", slide);
          wrap.classList.toggle("is-sliding", slide); // opens the arrow gutters
          ensureArrows(slide);
        }
        if (dropdown) ensureArrows(false); // no arrows to leave behind
      }

      // `fire` is false for programmatic sets so restoring state can't loop
      // back into the cascade that triggered it.
      function set(v, fire) {
        value = v === "" || v == null ? null : v;
        if (mode === "dropdown") {
          sel.value = value == null ? "" : value;
        } else {
          Array.prototype.forEach.call(chips.querySelectorAll(".crc-ds__chip"), function (c) {
            c.classList.toggle("is-active", c.getAttribute("data-value") === value);
          });
        }
        if (fire && opts.onChange) opts.onChange(value);
      }

      sel.addEventListener("change", function () { set(this.value, true); });

      return {
        setMode: function (m) { mode = m === "dropdown" ? "dropdown" : "pills"; paint(); },
        setItems: function (list) {
          items = list || [];
          if (items.indexOf(value) === -1) value = null;
          paint();
        },
        set: set,
        get: function () { return value; },
        clear: function () { items = []; value = null; paint(); },
      };
    }

    // ---- appearance -------------------------------------------------------
    // Everything here is resolved server-side (app/lib/appearance.js) and
    // applied verbatim — no style decisions are made in the browser.

    // The loading spinner is on screen BEFORE /options can answer, so on a cold
    // visit it can only use the stylesheet defaults. Remembering the last known
    // vars lets every subsequent visit paint it in the merchant's colour. Only
    // the vars are replayed, never the control types or custom CSS: those would
    // move the layout if the merchant had since changed them.
    var VARS_KEY = "crc-ds-vars";

    function setVars(vars) {
      Object.keys(vars).forEach(function (k) {
        root.style.setProperty(k, vars[k]);
      });
    }

    function applyCachedVars() {
      try {
        var cached = JSON.parse(localStorage.getItem(VARS_KEY) || "null");
        if (cached && typeof cached === "object") setVars(cached);
      } catch (e) { /* private mode, quota, corrupt value — defaults are fine */ }
    }

    function applyAppearance(bundle) {
      if (!bundle) return;
      if (bundle.vars) {
        setVars(bundle.vars);
        try { localStorage.setItem(VARS_KEY, JSON.stringify(bundle.vars)); } catch (e) { /* ignore */ }
      }
      if (bundle.rootClasses) {
        bundle.rootClasses.split(/\s+/).forEach(function (c) {
          if (c) root.classList.add(c);
        });
      }
      if (bundle.css) {
        var style = document.createElement("style");
        style.setAttribute("data-crc-ds-custom", "");
        style.textContent = bundle.css;
        root.appendChild(style);
      }
      // Set before setMode, which repaints the fields and reads this.
      if (bundle.pills) {
        pillCfg = {
          slider: bundle.pills.slider !== false,
          after: bundle.pills.after > 0 ? bundle.pills.after : 8,
        };
      }
      var controls = bundle.controls || {};
      Object.keys(fields).forEach(function (k) {
        if (fields[k]) fields[k].setMode(controls[k] || "dropdown");
      });
    }

    // ---- cascade derivations from server combos -------------------------
    function caratsFor(origin) {
      var list = combos[origin] || [];
      var cs = uniq(list.map(function (r) { return r.carat; }));
      cs.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
      return cs;
    }
    function coloursFor(origin, carat) {
      var cs = (combos[origin] || []).filter(function (r) { return r.carat === carat; })
        .map(function (r) { return r.colour; });
      cs = uniq(cs);
      cs.sort(function (a, b) { return rank(COLOUR_RANK, a) - rank(COLOUR_RANK, b); });
      return cs;
    }
    function claritiesFor(origin, carat, colour) {
      var cs = (combos[origin] || []).filter(function (r) {
        return r.carat === carat && r.colour === colour;
      }).map(function (r) { return r.clarity; });
      cs = uniq(cs);
      cs.sort(function (a, b) { return rank(CLARITY_RANK, a) - rank(CLARITY_RANK, b); });
      return cs;
    }

    // ---- resets ---------------------------------------------------------
    function resetFromCarat() {
      state.carat = null; state.colour = null; state.clarity = null;
      fields.carat.set(null);
      fields.colour.clear(); fields.clarity.clear();
      lock("colour"); lock("clarity");
    }

    // ---- price refresh --------------------------------------------------
    function refreshPrice() {
      var ready = state.origin && state.carat && state.colour && state.clarity;
      if (!ready) {
        if (el.stone) el.stone.innerHTML = '<span class="crc-ds__pending">Pending selection</span>';
        if (el.facet) el.facet.textContent = "Select to preview specification";
        el.cta.disabled = true;
        el.cta.textContent = root.querySelector("[data-ds-cta]").getAttribute("data-default") || el.cta.textContent;
        if (el.props) el.props.innerHTML = "<strong>Your specification</strong><br><span class='crc-ds__none'>Continue selecting above.</span>";
        return;
      }
      var url = proxyBase + "/price?productId=" + encodeURIComponent(productGid) +
        "&shape=" + encodeURIComponent(shape) +
        "&origin=" + encodeURIComponent(state.origin) +
        "&carat=" + encodeURIComponent(state.carat) +
        "&colour=" + encodeURIComponent(state.colour) +
        "&clarity=" + encodeURIComponent(state.clarity);
      // Enable Add to cart instantly — the server re-prices on add, so we don't
      // need to wait for the live total to come back.
      el.cta.disabled = false;
      el.cta.textContent = "Add to cart";
      if (el.stone) el.stone.innerHTML = '<span class="crc-ds__pending">Calculating…</span>';
      if (el.facet) el.facet.textContent = state.carat + "ct · " + state.colour + " · " + state.clarity +
        " · " + (state.origin === "natural" ? "Natural" : "Lab");
      if (el.props) el.props.innerHTML = "<strong>Your specification</strong><br>" +
        (state.origin === "natural" ? "Natural" : "Lab grown") + " " + shape + " cut · " +
        state.carat + " carat · colour " + state.colour + " · clarity " + state.clarity +
        "<br>Ring size " + (state.size || "—");

      var reqCarat = state.carat, reqColour = state.colour, reqClarity = state.clarity, reqOrigin = state.origin;
      fetch(url, { headers: { Accept: "application/json" } })
        .then(function (r) { if (!r.ok) throw new Error("server"); return r.json(); })
        .then(function (data) {
          // Ignore stale responses if the shopper changed selection meanwhile.
          if (reqCarat !== state.carat || reqColour !== state.colour || reqClarity !== state.clarity || reqOrigin !== state.origin) return;
          if (!data.ok) { el.cta.disabled = true; showMsg(data.reason || "Price unavailable for this combination.", "error"); return; }
          clearMsg();
          var m = toPresentment(data); // show the visitor's currency, not raw GBP
          if (el.base) el.base.textContent = m.base;
          if (el.stone) el.stone.textContent = m.stone;
          if (el.total) el.total.textContent = m.total;
          el.cta.textContent = "Add to cart · " + m.total;
        })
        .catch(function () { showMsg("Could not reach pricing. Please retry.", "error"); });
    }

    // ---- step wiring ----------------------------------------------------
    function pickOrigin(origin) {
      if (!origin) return;
      state.origin = origin;
      if (el.hintOrigin) el.hintOrigin.textContent = (origin === "natural" ? "Natural" : "Lab") + " selected";
      resetFromCarat();
      fields.carat.setItems(caratsFor(origin));
      unlock("carat");
      setImage(resolveImage(null)); // reset to featured until a carat is chosen
      renderThumbs(origin);
      refreshPrice();
    }

    function pickColour(colour) {
      state.colour = colour;
      state.clarity = null;
      fields.clarity.clear();
      if (!colour) { lock("clarity"); refreshPrice(); return; }
      fields.clarity.setItems(claritiesFor(state.origin, state.carat, colour));
      unlock("clarity");
      refreshPrice();
    }

    function pickClarity(clarity) {
      state.clarity = clarity;
      if (clarity) unlock("size");
      refreshPrice();
    }

    function selectCarat(caratVal) {
      fields.carat.set(caratVal || null);
      state.carat = caratVal || null;
      state.colour = null; state.clarity = null;
      fields.clarity.clear(); lock("clarity");
      setImage(resolveImage(state.carat)); // swap ring photo by carat (syncs active thumb)
      if (!state.carat) { fields.colour.clear(); lock("colour"); refreshPrice(); return; }
      fields.colour.setItems(coloursFor(state.origin, state.carat));
      unlock("colour");
      refreshPrice();
    }

    var fields = {
      origin: makeField("origin", {
        label: function (o) { return o === "natural" ? "Natural" : "Lab Grown"; },
        onChange: pickOrigin,
      }),
      carat: makeField("carat", {
        label: function (c) { return parseFloat(c).toFixed(2) + " ct"; },
        placeholder: "Select carat weight",
        onChange: selectCarat,
      }),
      colour: makeField("colour", { onChange: pickColour }),
      clarity: makeField("clarity", { onChange: pickClarity }),
      size: makeField("size", {
        // No "Size " prefix — the step is already labelled "Ring size", and the
        // repetition was eating the width of every pill.
        onChange: function (s) { state.size = s; refreshPrice(); },
      }),
    };

    // Both controls ship hidden so neither can flash before the merchant's
    // choice arrives. Reveal dropdowns now as the floor — matching the default
    // in app/lib/appearance.js — so a failed /options call leaves a usable
    // block rather than five empty rows.
    Object.keys(fields).forEach(function (k) {
      if (fields[k]) fields[k].setMode("dropdown");
    });

    // Thumbnails — mode chosen in block settings: per-carat images, or the
    // product's own gallery images (like a native product image switcher).
    function thumbImage(carat) {
      // Prefer the carat's own image; fall back so every carat still gets a thumb.
      return serverImages[carat] || altMatch(carat) || featuredImage || (media[0] && media[0].src) || null;
    }
    function unionCarats() {
      var seen = {};
      ["natural", "lab"].forEach(function (o) {
        (combos[o] || []).forEach(function (r) { if (r.carat) seen[r.carat] = 1; });
      });
      return Object.keys(seen).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
    }
    function selectOrigin(o) {
      fields.origin.set(o, true);
    }
    function onCaratThumb(c) {
      // Carat needs an origin for pricing; auto-pick one if the shopper clicked a thumb first.
      if (!state.origin) selectOrigin((combos.natural && combos.natural.length) ? "natural" : "lab");
      selectCarat(c);
    }
    function renderCaratThumbs(origin) {
      el.thumbs.innerHTML = "";
      var carats = origin ? caratsFor(origin) : unionCarats();
      var any = false;
      carats.forEach(function (c) {
        var src = thumbImage(c);
        if (!src) return;
        any = true;
        var t = document.createElement("div");
        t.className = "crc-ds__thumb";
        t.setAttribute("data-thumb-carat", c);
        t.innerHTML = '<img src="' + src + '" alt="' + c + 'ct" loading="lazy"><span>' + parseFloat(c).toFixed(2) + "ct</span>";
        t.addEventListener("click", function () { onCaratThumb(c); });
        el.thumbs.appendChild(t);
      });
      el.thumbs.style.display = any ? "" : "none";
    }
    function renderProductThumbs() {
      el.thumbs.innerHTML = "";
      var imgs = media.filter(function (m) { return m && m.src; });
      if (!imgs.length) { el.thumbs.style.display = "none"; return; }
      el.thumbs.style.display = "";
      imgs.forEach(function (m) {
        var t = document.createElement("div");
        t.className = "crc-ds__thumb";
        t.setAttribute("data-thumb-src", m.src);
        t.innerHTML = '<img src="' + m.src + '" alt="' + (m.alt || "") + '" loading="lazy">';
        t.addEventListener("click", function () { setImage(m.src); });
        el.thumbs.appendChild(t);
      });
    }
    function renderThumbs(origin) {
      if (!el.thumbs) return; // compact block has no gallery — nothing to build
      if (thumbSource === "product") renderProductThumbs(); else renderCaratThumbs(origin);
      console.log("[crc-ds] renderThumbs", { mode: thumbSource, origin: origin,
        mappedCarats: Object.keys(serverImages).length, thumbsBuilt: el.thumbs.children.length,
        display: el.thumbs.style.display });
      updateThumbActive();
    }
    function updateThumbActive() {
      if (!el.thumbs) return;
      var mainSrc = el.image ? el.image.getAttribute("src") : null;
      Array.prototype.forEach.call(el.thumbs.querySelectorAll(".crc-ds__thumb"), function (t) {
        var active = thumbSource === "product"
          ? t.getAttribute("data-thumb-src") === mainSrc
          : t.getAttribute("data-thumb-carat") === state.carat;
        t.classList.toggle("is-active", active);
      });
    }

    // ---- open the theme's own cart UI (drawer / notification) -----------
    function sectionInner(html, sel) {
      try {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var node = doc.querySelector(sel) || doc.body;
        return node ? node.innerHTML : html;
      } catch (e) { return html; }
    }
    function openThemeCart(sections) {
      // Refresh the header cart count if the theme exposes it.
      if (sections && sections["cart-icon-bubble"]) {
        var bubble = document.getElementById("cart-icon-bubble") ||
          document.querySelector(".cart-count-bubble, [data-cart-count], .cart-link__bubble");
        if (bubble) { try { bubble.innerHTML = sectionInner(sections["cart-icon-bubble"], "#cart-icon-bubble, .shopify-section"); } catch (e) { /* ignore */ } }
      }

      // Notification style (small popup — Dawn "notification" cart type).
      var note = document.querySelector("cart-notification");
      if (note && cartType === "notification") {
        if (sections && sections["cart-notification"]) { try { note.innerHTML = sectionInner(sections["cart-notification"], "cart-notification"); } catch (e) { /* ignore */ } }
        try { if (typeof note.open === "function") { note.open(); return true; } } catch (e) { /* ignore */ }
      }

      // Drawer style — Dawn, Maestrooo (Impact/Craft), Horizon and most themes.
      var drawer = document.querySelector("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer]");
      if (drawer) {
        // Replace the WHOLE drawer element with the freshly-rendered one. Injecting
        // innerHTML strips the element's own slot structure (header/footer) and
        // leaves an empty gap at the top; swapping the element keeps it intact.
        if (sections && sections["cart-drawer"]) {
          try {
            var doc2 = new DOMParser().parseFromString(sections["cart-drawer"], "text/html");
            var fresh = doc2.querySelector("cart-drawer, #CartDrawer, .cart-drawer");
            if (fresh && drawer.parentNode) { drawer.replaceWith(fresh); drawer = fresh; }
            else if (!fresh) { drawer.innerHTML = sectionInner(sections["cart-drawer"], "cart-drawer, #CartDrawer, .cart-drawer"); }
          } catch (e) { /* ignore */ }
        }
        drawer.classList.remove("is-empty");

        // Prefer the theme's own open method (runs focus trap / overlay / scroll lock).
        var methods = ["open", "show", "showModal", "renderContents"];
        for (var i = 0; i < methods.length; i++) {
          if (typeof drawer[methods[i]] === "function") {
            try { drawer[methods[i]](); return true; } catch (e) { /* ignore */ }
          }
        }
        // Fallback to the attribute/class conventions themes use for CSS-driven drawers.
        try { drawer.setAttribute("open", ""); } catch (e) { /* ignore */ }
        drawer.removeAttribute("hidden");
        drawer.classList.add("active", "animate", "is-open", "open", "drawer--open");
        document.body.classList.add("overflow-hidden", "js-drawer-open", "cart-drawer-open");
        // Nudge themes that open/refresh their drawer on a cart event.
        try { document.dispatchEvent(new CustomEvent("cart:refresh", { bubbles: true })); } catch (e) { /* ignore */ }
        return true;
      }
      return false;
    }

    // Remember each minted line's image so we can repaint EVERY one of our lines
    // whenever the drawer re-renders (a new add re-renders the whole drawer and
    // would otherwise wipe earlier lines). sessionStorage survives reloads.
    var LINE_IMG_KEY = "crc-line-imgs";
    function readLineImgs() {
      try { return JSON.parse(sessionStorage.getItem(LINE_IMG_KEY) || "{}") || {}; } catch (e) { return {}; }
    }
    function rememberLineImg(variantId, url) {
      if (!variantId || !url) return;
      try { var m = readLineImgs(); m[variantId] = url; sessionStorage.setItem(LINE_IMG_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
    }
    // Set (or create) the photo for one cart line. No-op unless we can pin the
    // exact line by its variant id, so we never touch the wrong line.
    function injectLineImage(variantId, url) {
      if (!variantId || !url) return;
      var scope = document.querySelector("cart-drawer, #CartDrawer, .cart-drawer, [data-cart-drawer], cart-notification") || document;
      var hit = scope.querySelector(
        'a[href*="variant=' + variantId + '"], [data-line-key^="' + variantId + ':"], ' +
        '[data-variant-id="' + variantId + '"], [data-cart-item-variant-id="' + variantId + '"]',
      );
      if (!hit) return;
      var line = (hit.closest && hit.closest("line-item, .line-item, .cart-item, .cart-drawer__item, li, tr, .cart__row")) || hit.parentNode;
      if (!line || !line.querySelector) return;
      var img = line.querySelector("img");
      if (img) {
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.setAttribute("src", url);
        return;
      }
      // Theme rendered no <img> (product has no media) — drop one into the line's
      // media slot so the line isn't blank.
      var slot = line.querySelector(".line-item__media, .cart-item__media, .cart-item__image, .cart__image, [class*='__media'], [class*='__image']");
      if (!slot) return;
      var made = document.createElement("img");
      made.src = url;
      made.alt = "";
      made.loading = "lazy";
      made.style.width = "100%";
      made.style.height = "100%";
      made.style.objectFit = "cover";
      if (slot.tagName === "IMG") { slot.replaceWith(made); } else { slot.appendChild(made); }
    }
    // Repaint every one of our lines currently in the drawer.
    function paintLineImages() {
      var m = readLineImgs();
      Object.keys(m).forEach(function (vid) { injectLineImage(vid, m[vid]); });
    }

    // ---- add to cart ----------------------------------------------------
    el.cta.setAttribute("data-default", el.cta.textContent);
    el.cta.addEventListener("click", function () {
      if (el.cta.disabled) return;
      clearMsg();
      el.cta.disabled = true;
      var original = el.cta.textContent;
      el.cta.textContent = "Adding…";
      var lineImageUrl = resolveImage(state.carat) || featuredImage || null;
      var addedVariantId = null;
      var addedTotalGBP = 0;

      fetch(proxyBase + "/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          productId: productGid, shape: shape,
          origin: state.origin, carat: state.carat, colour: state.colour,
          clarity: state.clarity, size: state.size,
        }),
      })
        .then(function (r) {
          // Guard against non-JSON error pages (e.g. a 500) so we never blow up on JSON.parse.
          if (!r.ok) throw new Error("server");
          return r.json();
        })
        .then(function (data) {
          if (!data.ok) throw new Error(data.reason || "cart_failed");
          addedVariantId = data.variantId;
          addedTotalGBP = moneyNum(data.totalFormatted); // GBP total for the FX-rate learning below
          var sectionList = cartType === "notification" ? "cart-notification,cart-icon-bubble" : "cart-drawer,cart-icon-bubble";
          return fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              items: [{ id: Number(data.variantId), quantity: 1, properties: data.properties }],
              sections: sectionList,
              sections_url: window.location.pathname,
            }),
          }).then(function (r) {
            if (!r.ok) return r.json().then(function (e) { throw new Error(e.description || "add_failed"); });
            return r.json();
          });
        })
        .then(function (added) {
          // Always open the theme's cart drawer if one exists; only fall back to the
          // cart page when the theme has no drawer/notification UI at all.
          // Learn the REAL FX rate from the cart line: it's Shopify's exact
          // converted price for a variant whose GBP total we know. Cache it so the
          // next price preview matches the cart precisely (no ~100 rounding gap).
          try {
            var ln = added && (added.items ? added.items[0] : added);
            var presCents = ln && (ln.final_line_price || ln.line_price || ln.price);
            if (presCents && addedTotalGBP > 0) {
              var learned = presCents / 100 / addedTotalGBP;
              cacheRate(learned);
              console.log("[crc-ds] learned FX rate:", learned, "→ cached for", CUR);
            }
          } catch (e) { /* ignore */ }

          rememberLineImg(addedVariantId, lineImageUrl);
          var opened = openThemeCart(added && added.sections);
          if (!opened) { window.location.href = "/cart"; return; }
          // Paint ALL our lines now, and once more after the theme settles/re-renders.
          paintLineImages();
          setTimeout(paintLineImages, 250);
          // Keep the "Adding…" loader on the button until the drawer has slid open,
          // so it never disappears a beat before the cart is visible.
          setTimeout(function () {
            el.cta.disabled = false; el.cta.textContent = original; // ready for another add
          }, 450);
        })
        .catch(function () {
          showMsg("Sorry, we couldn't add this to your cart. Please try again in a moment.", "error");
          el.cta.disabled = false; el.cta.textContent = original;
        });
    });

    // ---- boot: sizes + origin, then fetch valid combos ------------------
    function boot() {
      fetch(proxyBase + "/options?shape=" + encodeURIComponent(shape) + "&productId=" + encodeURIComponent(productGid), { headers: { Accept: "application/json" } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          // Merchant toggled the selector off for this ring page.
          if (data.enabled === false) { root.style.display = "none"; return; }
          combos = data.combos || { natural: [], lab: [] };
          serverImages = data.images || {};

          // Styles first: this runs while the loading overlay is still up, so
          // the shopper never sees the default theme repaint into the custom one.
          applyAppearance(data.appearance);

          console.log("[crc-ds] options loaded:", {
            enabled: data.enabled,
            naturalRows: (combos.natural || []).length,
            labRows: (combos.lab || []).length,
            sizes: (data.sizes || []).length,
            controls: data.appearance && data.appearance.controls,
            raw: data,
          });

          // ring sizes — preselected, since size carries no price impact
          var sizes = data.sizes || [];
          fields.size.setItems(sizes);
          if (sizes.length) fields.size.set(sizes[0]);
          state.size = sizes[0] || null;

          // origins — only show those that actually have prices loaded
          var origins = [];
          if ((combos.natural || []).length) origins.push("natural");
          if ((combos.lab || []).length) origins.push("lab");
          if (!origins.length) { root.classList.remove("is-loading"); showMsg("No diamond prices are loaded yet.", "error"); return; }
          fields.origin.setItems(origins);
          renderThumbs(state.origin); // build thumbnails now that combos + images are loaded
          root.classList.remove("is-loading"); // reveal the ready selector
        })
        .catch(function () { root.classList.remove("is-loading"); showMsg("Could not load diamond options.", "error"); });
    }

    // Drag-to-scroll the thumbnail slider (desktop); touch swipe is native.
    function enableThumbDrag() {
      var t = el.thumbs;
      if (!t) return;
      var down = false, moved = false, startX = 0, startScroll = 0;
      t.addEventListener("mousedown", function (e) { down = true; moved = false; startX = e.pageX; startScroll = t.scrollLeft; });
      t.addEventListener("mousemove", function (e) {
        if (!down) return;
        var dx = e.pageX - startX;
        if (Math.abs(dx) > 4) { moved = true; t.classList.add("is-dragging"); }
        if (moved) t.scrollLeft = startScroll - dx;
      });
      window.addEventListener("mouseup", function () { down = false; t.classList.remove("is-dragging"); });
      // Cancel the click that follows a drag so it doesn't select a carat.
      t.addEventListener("click", function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    }

    applyCachedVars(); // paint the spinner in the merchant's colour, pre-fetch
    enableThumbDrag();
    renderThumbs(null);

    // Size guide: intercept the link and open the in-page modal when the
    // block is configured in "modal" mode. Falls back to the link's default
    // new-tab behaviour if the modal markup is not present.
    (function wireSizeGuide() {
      var link = root.querySelector("[data-ds-sizeguide]");
      var modal = root.querySelector("[data-ds-sg-modal]");
      if (!link || !modal) return;
      function open(e) {
        if (e) e.preventDefault();
        modal.hidden = false;
        document.addEventListener("keydown", onKey);
      }
      function close() {
        modal.hidden = true;
        document.removeEventListener("keydown", onKey);
      }
      function onKey(e) { if (e.key === "Escape" || e.keyCode === 27) close(); }
      link.addEventListener("click", open);
      Array.prototype.forEach.call(modal.querySelectorAll("[data-ds-sg-close]"), function (b) {
        b.addEventListener("click", close);
      });
    })();

    boot();
  }

  function initAll() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-crc-ds]"), function (root) {
      if (root.__crcInit) return;
      root.__crcInit = true;
      initRoot(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  // Re-init when Shopify theme editor injects the block.
  document.addEventListener("shopify:section:load", initAll);
})();
