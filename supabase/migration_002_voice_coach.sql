-- Liftmate update 002: counts "bad reps" separately.
-- Run once in Supabase > SQL Editor if you already ran schema.sql before this update.
alter table sets add column if not exists reps_bad int default 0;
