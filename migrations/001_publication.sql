create schema if not exists chogmog;
revoke all on schema chogmog from public;

create table chogmog.auth_challenges (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  data jsonb not null,
  expires_at timestamptz not null
);
create table chogmog.sessions (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  data jsonb not null,
  expires_at timestamptz not null
);
create table chogmog.publish_grants (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  data jsonb not null,
  expires_at timestamptz not null,
  consumed boolean not null default false
);
create table chogmog.works (
  kind text not null check (kind in ('part', 'machine')),
  id text not null check (id ~ '^[a-z][a-z0-9-]{0,63}$'),
  author text not null check (author ~ '^0x[a-f0-9]{40}$'),
  nft jsonb,
  primary key (kind, id),
  check ((kind = 'part') = (nft is not null))
);
create table chogmog.versions (
  id text primary key check (id ~ '^sha256:[a-f0-9]{64}$'),
  kind text not null,
  work_id text not null,
  author text not null check (author ~ '^0x[a-f0-9]{40}$'),
  content jsonb not null,
  canonical text not null check (octet_length(canonical) <= 65536),
  ownership jsonb,
  published_at timestamptz not null default clock_timestamp(),
  foreign key (kind, work_id) references chogmog.works (kind, id),
  check (canonical::jsonb = content),
  check (id = 'sha256:' || encode(sha256(convert_to(canonical, 'UTF8')), 'hex')),
  check (content->>'author' = author and content->>'kind' = kind),
  check (coalesce(content->>'partId', content->>'machineId') = work_id),
  check ((kind = 'part') = (ownership is not null))
);
create table chogmog.credits (
  machine_version text not null references chogmog.versions (id),
  part_version text not null references chogmog.versions (id),
  author text not null,
  primary key (machine_version, part_version)
);
create table chogmog.receipts (
  author text not null,
  key text not null check (key ~ '^[a-zA-Z0-9_-]{16,64}$'),
  version_id text not null references chogmog.versions (id),
  primary key (author, key)
);
create index on chogmog.auth_challenges (expires_at);
create index on chogmog.sessions (expires_at);
create index on chogmog.publish_grants (expires_at);

create function chogmog.immutable() returns trigger language plpgsql
set search_path = pg_catalog as $$
begin
  raise exception 'Published records are immutable';
end;
$$;
create trigger immutable_works before update or delete on chogmog.works for each row execute function chogmog.immutable();
create trigger immutable_versions before update or delete on chogmog.versions for each row execute function chogmog.immutable();
create trigger immutable_credits before update or delete on chogmog.credits for each row execute function chogmog.immutable();
create trigger immutable_receipts before update or delete on chogmog.receipts for each row execute function chogmog.immutable();

alter table chogmog.auth_challenges enable row level security;
alter table chogmog.sessions enable row level security;
alter table chogmog.publish_grants enable row level security;
alter table chogmog.works enable row level security;
alter table chogmog.versions enable row level security;
alter table chogmog.credits enable row level security;
alter table chogmog.receipts enable row level security;
revoke all on all tables in schema chogmog from public;
revoke all on all functions in schema chogmog from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on schema chogmog from %I', r);
      execute format('revoke all on all tables in schema chogmog from %I', r);
      execute format('revoke all on all functions in schema chogmog from %I', r);
    end if;
  end loop;
end;
$$;
