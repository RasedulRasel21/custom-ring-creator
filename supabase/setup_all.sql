-- ============================================================
-- Custom Ring Creator — FULL setup (run once in a NEW project)
-- Combines schema.sql + v2 + v3 + v4 + v5 in the correct order.
-- Supabase → SQL Editor → paste all → Run.
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>>  schema.sql  <<<<<<<<<<<<<<<<<<<<
-- ============================================================================
--  Custom Ring Creator — Supabase schema
--  Run this in Supabase → SQL Editor once, against your project.
--  All money is stored as INTEGER PENCE (e.g. £1,200.00 -> 120000) to avoid
--  floating-point rounding on high-value orders (natural stones reach £101,500).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  diamond_prices — one row per valid stone combination, per shop.
--  Populated by the monthly CSV upload in the app admin.
-- ----------------------------------------------------------------------------
create table if not exists public.diamond_prices (
  id           bigint generated always as identity primary key,
  shop         text        not null,               -- myshop.myshopify.com
  shape        text        not null default 'emerald',
  origin       text        not null,               -- 'natural' | 'lab'
  carat        numeric(4,2) not null,              -- 1.00 .. 4.00
  colour       text        not null,               -- 'D' | 'E' | 'F'
  clarity      text        not null,               -- 'VS1' | 'VVS2' | 'VVS1'
  price_pence  bigint      not null check (price_pence >= 0),
  updated_at   timestamptz not null default now(),
  -- one price per exact combination
  unique (shop, shape, origin, carat, colour, clarity)
);

create index if not exists diamond_prices_lookup_idx
  on public.diamond_prices (shop, shape, origin);

-- ----------------------------------------------------------------------------
--  ring_pages — optional per-product base-price override.
--  If a ring product has NO row here, the app falls back to the product's own
--  Shopify price as the base (recommended: just set the product price = base).
-- ----------------------------------------------------------------------------
create table if not exists public.ring_pages (
  id               bigint generated always as identity primary key,
  shop             text        not null,
  product_id       text        not null,           -- numeric Shopify product id
  title            text,                            -- e.g. "18k Ring A"
  metal            text,                            -- e.g. "18k Yellow Gold"
  shape            text        not null default 'emerald',
  base_price_pence bigint      check (base_price_pence >= 0),
  updated_at       timestamptz not null default now(),
  unique (shop, product_id)
);

-- ----------------------------------------------------------------------------
--  dynamic_variants — cache of variants minted for a price combo, so we reuse
--  a variant instead of creating a new one on every add-to-cart. Because the
--  combo key includes the total price, a monthly price change naturally mints
--  fresh variants and leaves old ones intact for any in-flight carts.
-- ----------------------------------------------------------------------------
create table if not exists public.dynamic_variants (
  id           bigint generated always as identity primary key,
  shop         text        not null,
  product_id   text        not null,
  variant_id   text        not null,               -- numeric Shopify variant id
  combo_key    text        not null,               -- shape:origin:carat:colour:clarity:totalPence
  total_pence  bigint      not null,
  ordered      boolean     not null default false, -- set true on orders/create
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (shop, product_id, combo_key)
);

create index if not exists dynamic_variants_prune_idx
  on public.dynamic_variants (shop, ordered, last_used_at);

-- ----------------------------------------------------------------------------
--  RLS: these tables are only ever touched by the app server using the SECRET
--  key (which bypasses RLS). We still enable RLS with no public policies so
--  nothing is reachable with the publishable/anon key. Defence in depth.
-- ----------------------------------------------------------------------------
alter table public.diamond_prices   enable row level security;
alter table public.ring_pages       enable row level security;
alter table public.dynamic_variants enable row level security;


-- >>>>>>>>>>>>>>>>>>>>  schema_v2.sql  <<<<<<<<<<<<<<<<<<<<
-- ============================================================================
--  Custom Ring Creator — migration v2
--  Run this in Supabase → SQL Editor AFTER schema.sql.
--  Adds: per-ring "enabled" toggle, and a shop-level settings store.
-- ============================================================================

-- Live/Hidden toggle for the selector on a given ring page.
alter table public.ring_pages
  add column if not exists enabled boolean not null default true;

-- One settings row per shop (which line-item specs to record, etc.).
create table if not exists public.shop_settings (
  shop        text        primary key,
  settings    jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.shop_settings enable row level security;


-- >>>>>>>>>>>>>>>>>>>>  schema_v3.sql  <<<<<<<<<<<<<<<<<<<<
-- ============================================================================
--  Custom Ring Creator — migration v3  (per-carat images)
--  Run in Supabase → SQL Editor AFTER schema.sql and schema_v2.sql.
--  Idempotent and additive — does not touch existing data.
-- ============================================================================

-- Optional image URL carried on price rows (the CSV "image_url" column).
alter table public.diamond_prices
  add column if not exists image_url text;

-- Explicit per-carat image assignments made in the app admin (highest priority).
create table if not exists public.carat_images (
  id          bigint generated always as identity primary key,
  shop        text        not null,
  shape       text        not null default 'emerald',
  carat       numeric(4,2) not null,
  image_url   text        not null,
  updated_at  timestamptz not null default now(),
  unique (shop, shape, carat)
);

create index if not exists carat_images_lookup_idx
  on public.carat_images (shop, shape);

alter table public.carat_images enable row level security;


-- >>>>>>>>>>>>>>>>>>>>  schema_v4.sql  <<<<<<<<<<<<<<<<<<<<
-- ============================================================================
--  Custom Ring Creator — migration v4  (Shopify session storage)
--  Run in Supabase → SQL Editor. Needed when hosting on Vercel/serverless,
--  where the local SQLite session store does not persist.
-- ============================================================================

create table if not exists public.shopify_sessions (
  id          text        primary key,      -- Shopify session id
  shop        text        not null,
  session     jsonb       not null,          -- serialized Session (property array)
  updated_at  timestamptz not null default now()
);

create index if not exists shopify_sessions_shop_idx
  on public.shopify_sessions (shop);

alter table public.shopify_sessions enable row level security;


-- >>>>>>>>>>>>>>>>>>>>  schema_v5.sql  <<<<<<<<<<<<<<<<<<<<
-- v5: product-per-order model
-- Every Add-to-cart mints a fresh, hidden-but-buyable product. We log each one
-- here so a scheduled cleanup job can prune abandoned-cart orphans (products
-- that never became an order). Run this in the Supabase SQL editor.

create table if not exists minted_products (
  id          bigint generated always as identity primary key,
  shop        text        not null,
  product_id  text        not null,
  variant_id  text        not null,
  combo_key   text,
  total_pence integer,
  created_at  timestamptz not null default now()
);

create index if not exists minted_products_shop_created_idx
  on minted_products (shop, created_at);

-- Match the other tables: RLS on with no policies. The app connects with the
-- service_role key, which bypasses RLS; this only shuts out anon/authenticated.
alter table public.minted_products enable row level security;

