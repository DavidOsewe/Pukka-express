-- Run this in Supabase: SQL Editor > New query.
-- Safe to re-run; uses IF NOT EXISTS / OR REPLACE where possible.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  tracking_id text not null unique,
  carrier text not null default 'standalone'
    check (carrier in ('standalone', 'dhl', 'fedex', 'aramex')),
  carrier_waybill text,
  sender_name text not null,
  sender_email text not null,
  sender_phone text not null,
  sender_street text not null,
  recipient_name text not null,
  recipient_email text not null,
  recipient_phone text not null,
  recipient_street text not null,
  origin text not null,
  destination text not null,
  weight_kg numeric(10,2) not null check (weight_kg > 0),
  price_ngn numeric(12,2) not null check (price_ngn >= 0),
  status text not null default 'Shipment received'
    check (status in (
      'Shipment received',
      'Picked up',
      'In transit',
      'Out for delivery',
      'Delivered',
      'Delivery exception'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_tracking_id_idx on public.shipments (tracking_id);
create index if not exists shipments_carrier_waybill_idx on public.shipments (carrier_waybill);
create index if not exists shipments_status_idx on public.shipments (status);
create index if not exists shipments_created_at_idx on public.shipments (created_at desc);

create table if not exists public.shipment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status text not null,
  location text not null,
  note text,
  event_time timestamptz not null default now()
);

create index if not exists shipment_events_shipment_id_idx
  on public.shipment_events (shipment_id, event_time desc);

-- Keep updated_at current on every row change.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;

-- The Vercel server uses the service-role key; browser clients should not
-- talk to these tables directly. No permissive policies are added on purpose.

-- Auto-create a profile row when a Supabase Auth user is created.
create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_user();

-- After creating the first Supabase Authentication user, promote them:
-- insert into public.profiles (id, is_admin)
-- values ('PASTE_AUTH_USER_UUID_HERE', true)
-- on conflict (id) do update set is_admin = true;
