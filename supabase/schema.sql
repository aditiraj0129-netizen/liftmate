-- =====================================================================
-- Liftmate database schema (v1.0)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run on a fresh project only (it creates tables).
-- =====================================================================

create extension if not exists vector;

-- ---------- Gyms (shared by everyone) ----------
create table gyms (
  id uuid primary key default gen_random_uuid(),
  osm_id text unique,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz default now()
);

-- ---------- User profiles (one per login) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  age int check (age between 16 and 100),
  sex text check (sex in ('male','female','other')),
  height_cm numeric,
  weight_kg numeric,
  goal text check (goal in ('fat_loss','muscle_gain','recomp','strength','endurance')),
  diet_type text check (diet_type in ('veg','non_veg','eggetarian','vegan','jain')),
  experience text check (experience in ('beginner','intermediate','advanced')),
  training_days int default 4 check (training_days between 1 and 7),
  language text default 'en' check (language in ('en','hi')),
  gym_id uuid references gyms(id),
  visibility text default 'gym' check (visibility in ('public','gym','connections')),
  created_at timestamptz default now()
);

-- Create an empty profile automatically when someone signs up
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name) values (new.id, new.raw_user_meta_data->>'name');
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Connections between people ----------
create table connections (
  requester_id uuid references profiles(id) on delete cascade,
  receiver_id uuid references profiles(id) on delete cascade,
  status text default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz default now(),
  primary key (requester_id, receiver_id),
  check (requester_id <> receiver_id)
);

-- ---------- Exercise library ----------
create table exercises (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_hi text,
  family text not null check (family in ('barbell','dumbbell','machine','cable','bodyweight','hold')),
  muscles text[] default '{}',
  secondary_muscles text[] default '{}',
  equipment text,
  difficulty text,
  image_urls text[] default '{}',
  instructions text[] default '{}',
  engine text,            -- which AI coach engine counts reps for it (null = manual logging)
  curated boolean default false
);

-- ---------- Machine knowledge + machines at each gym ----------
create table machines (
  id uuid primary key default gen_random_uuid(),
  type text not null unique,
  name_en text not null,
  name_hi text,
  muscles text[] default '{}',
  guide jsonb default '{}'::jsonb,
  exercise_slug text
);

create table gym_machines (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id) on delete cascade,
  machine_id uuid not null references machines(id),
  sticker_text text,
  guide jsonb,
  added_by uuid references profiles(id),
  verified_count int default 1,
  created_at timestamptz default now(),
  unique (gym_id, machine_id)
);

-- ---------- Training sessions and sets ----------
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null default current_date,
  title text,
  start_time timestamptz default now(),
  end_time timestamptz,
  week_start date not null default date_trunc('week', current_date)::date, -- always a Monday
  checkin jsonb default '{}'::jsonb,
  plan jsonb default '{}'::jsonb
);

create table sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  weight_kg numeric,
  reps_full int default 0,
  reps_partial int default 0,
  reps_bad int default 0,
  form_score int check (form_score between 0 and 100),
  est_rir int,
  good_points text[] default '{}',
  improve_points text[] default '{}',
  source text default 'manual' check (source in ('ai','manual')),
  created_at timestamptz default now()
);

-- ---------- Nutrition ----------
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null default current_date,
  eaten_at timestamptz default now(),
  description text,
  items jsonb not null default '[]'::jsonb,
  kcal numeric default 0, protein_g numeric default 0, carbs_g numeric default 0, fat_g numeric default 0,
  source text default 'text' check (source in ('voice','photo','text'))
);

create table nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  targets jsonb not null,
  plan jsonb not null,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

-- ---------- AI memory, chat history and pain logs ----------
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  embedding vector(768),   -- reserved for semantic search (later upgrade)
  created_at timestamptz default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  channel text not null default 'nutrition' check (channel in ('nutrition','coach')),
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table pain_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null default current_date,
  body_part text not null,
  level int check (level between 1 and 10),
  note text
);

-- ---------- Security (Row Level Security) ----------
-- The FastAPI backend uses the service key and checks the user itself.
-- These rules protect the data if anyone uses the public (anon) key directly.
alter table profiles enable row level security;
alter table gyms enable row level security;
alter table connections enable row level security;
alter table exercises enable row level security;
alter table machines enable row level security;
alter table gym_machines enable row level security;
alter table sessions enable row level security;
alter table sets enable row level security;
alter table meals enable row level security;
alter table nutrition_plans enable row level security;
alter table memories enable row level security;
alter table chat_messages enable row level security;
alter table pain_logs enable row level security;

create policy "read gyms" on gyms for select to authenticated using (true);
create policy "read exercises" on exercises for select to authenticated using (true);
create policy "read machines" on machines for select to authenticated using (true);
create policy "read gym machines" on gym_machines for select to authenticated using (true);

create policy "own profile" on profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "my connections" on connections for select to authenticated
  using (auth.uid() in (requester_id, receiver_id));

create policy "own sessions" on sessions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sets" on sets for all to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "own meals" on meals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own plans" on nutrition_plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own memories" on memories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own chats" on chat_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own pain logs" on pain_logs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Indexes for speed ----------
create index on sessions (user_id, week_start);
create index on sets (session_id);
create index on sets (exercise_id);
create index on meals (user_id, date);
create index on gym_machines (gym_id);
create index on profiles (gym_id);
create index on memories (user_id, created_at desc);
create index on chat_messages (user_id, channel, created_at desc);
create index on exercises (family);
