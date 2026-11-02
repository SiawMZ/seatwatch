-- Seatwatch database. Run this once in the Supabase SQL editor.
-- Tables have row level security on and no policies, so the browser can only
-- reach data through the functions below, which require a link token or room code.

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  edit_token uuid not null unique default gen_random_uuid(),
  name text not null,
  layout jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rooms (
  code text primary key,
  name text not null,
  layout jsonb not null,
  seats jsonb not null default '{}',
  extra integer not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table templates enable row level security;
alter table rooms enable row level security;

create or replace function check_template(p_name text, p_layout jsonb) returns void
language plpgsql as $$
begin
  if length(trim(p_name)) not between 1 and 80 then
    raise exception 'Template name must be 1 to 80 characters';
  end if;
  if jsonb_typeof(p_layout -> 'seats') is distinct from 'array'
     or jsonb_array_length(p_layout -> 'seats') not between 1 and 2000 then
    raise exception 'A template needs 1 to 2000 seats';
  end if;
end $$;

create or replace function initial_seats(p_layout jsonb) returns jsonb
language sql immutable as $$
  select coalesce(
    jsonb_object_agg(s ->> 'id', 'not_in_use') filter (where (s ->> 'inactive') = 'true'),
    '{}'::jsonb
  )
  from jsonb_array_elements(p_layout -> 'seats') s
$$;

create or replace function create_template(p_name text, p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  perform check_template(p_name, p_layout);
  insert into templates (name, layout) values (trim(p_name), p_layout)
  returning edit_token into v_token;
  return jsonb_build_object('token', v_token);
end $$;

create or replace function get_template(p_token uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('name', name, 'layout', layout)
  from templates where edit_token = p_token
$$;

create or replace function update_template(p_token uuid, p_name text, p_layout jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform check_template(p_name, p_layout);
  update templates set name = trim(p_name), layout = p_layout, updated_at = now()
  where edit_token = p_token;
  if not found then return null; end if;
  return jsonb_build_object('ok', true);
end $$;

-- A room with nobody in it for 2 hours is treated as gone straight away,
-- and its row is removed by the next cleanup.
create or replace function cleanup_rooms() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from rooms where last_seen_at < now() - interval '2 hours';
  get diagnostics v_count = row_count;
  return jsonb_build_object('deleted', v_count);
end $$;

create or replace function create_room(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_template templates;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  perform cleanup_rooms();
  select * into v_template from templates where edit_token = p_token;
  if not found then return null; end if;
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code from generate_series(1, 6);
    begin
      insert into rooms (code, name, layout, seats)
      values (v_code, v_template.name, v_template.layout, initial_seats(v_template.layout));
      return jsonb_build_object('code', v_code);
    exception when unique_violation then
      null; -- code already taken, try another
    end;
  end loop;
end $$;

-- Reading a room also counts as someone being in it.
create or replace function get_room(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  update rooms set last_seen_at = now()
  where code = upper(p_code) and last_seen_at >= now() - interval '2 hours'
  returning jsonb_build_object(
    'code', code, 'name', name, 'layout', layout, 'seats', seats, 'extra', extra
  )
$$;

-- Merges into the stored seats, so ushers marking different seats never overwrite each other.
create or replace function mark_seats(p_code text, p_patch jsonb) returns jsonb
language sql security definer set search_path = public as $$
  update rooms r set
    last_seen_at = now(),
    seats = r.seats || coalesce((
      select jsonb_object_agg(p.key, p.value)
      from jsonb_each(p_patch) p
      where p.value in ('"available"', '"occupied"', '"reserved"', '"not_in_use"')
        and exists (
          select 1 from jsonb_array_elements(r.layout -> 'seats') s where s ->> 'id' = p.key
        )
    ), '{}'::jsonb)
  where r.code = upper(p_code) and r.last_seen_at >= now() - interval '2 hours'
  returning jsonb_build_object('ok', true)
$$;

create or replace function add_extra(p_code text, p_delta integer) returns jsonb
language sql security definer set search_path = public as $$
  update rooms set last_seen_at = now(), extra = greatest(0, extra + p_delta)
  where code = upper(p_code) and last_seen_at >= now() - interval '2 hours'
  returning jsonb_build_object('extra', extra)
$$;

create or replace function reset_room(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  update rooms set last_seen_at = now(), seats = initial_seats(layout), extra = 0
  where code = upper(p_code) and last_seen_at >= now() - interval '2 hours'
  returning jsonb_build_object('seats', seats, 'extra', extra)
$$;
