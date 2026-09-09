-- Day 2 (Task 2.2/2.5): Voice Capture upload + processing job foundation.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the
-- Supabase SQL editor. It is idempotent, so it can be applied repeatedly.
--
-- Foundation only: transcription execution itself is the NEXT task.

-- ---------------------------------------------------------------------------
-- 1) Private storage bucket for original Voice Capture audio
-- ---------------------------------------------------------------------------
-- Server-side privileged uploads use the service role and always write
-- user-scoped paths: users/{userId}/memories/{memoryId}/captures/{captureId}.<ext>
-- No public access: no `public` bucket, no public policies.

insert into storage.buckets (id, name, public)
values ('voice-audio', 'voice-audio', false)
on conflict (id) do update set public = false;

-- Authenticated users may read their own audio objects (for example to build a
-- signed playback URL in a later task). Writes stay backend-only via the
-- service role, which bypasses RLS; users cannot upload/modify objects directly.
drop policy if exists "voice audio: select own objects" on storage.objects;
create policy "voice audio: select own objects" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'voice-audio'
        and (storage.foldername(name))[1] = 'users'
        and (storage.foldername(name))[2] = (select auth.uid()::text)
    );

-- ---------------------------------------------------------------------------
-- 2) Database-backed processing jobs (no Redis/Kafka/BullMQ/worker service)
-- ---------------------------------------------------------------------------

create table if not exists public.processing_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    memory_id text not null,
    capture_id text not null,
    job_type text not null default 'TRANSCRIPTION'
        check (job_type in ('TRANSCRIPTION')),
    status text not null default 'PENDING'
        check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    attempts integer not null default 0 check (attempts >= 0),
    available_at timestamptz not null default now(),
    error jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (job_type, capture_id)
);

-- Storage path of the uploaded original audio, needed by the transcription
-- worker to download the file from the private bucket.
alter table public.processing_jobs add column if not exists storage_path text;

create index if not exists processing_jobs_user_created_idx
    on public.processing_jobs (user_id, created_at desc);

create index if not exists processing_jobs_claim_idx
    on public.processing_jobs (status, available_at);

alter table public.processing_jobs enable row level security;

-- Users may read their own jobs; every write is performed by the backend with
-- the service role (bypasses RLS), so users cannot forge or alter jobs.
drop policy if exists "processing jobs: select own" on public.processing_jobs;
create policy "processing jobs: select own" on public.processing_jobs
    for select to authenticated
    using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Generated + user-edited transcripts (Day 2 final task)
-- ---------------------------------------------------------------------------
-- generated_transcript is written by the transcription worker and never
-- overwritten by edits; edited_transcript is written by the user and is
-- authoritative for display/search. Both columns are preserved independently.

create table if not exists public.capture_transcripts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    memory_id text not null,
    capture_id text not null,
    generated_transcript text,
    edited_transcript text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (capture_id)
);

create index if not exists capture_transcripts_user_idx
    on public.capture_transcripts (user_id);

alter table public.capture_transcripts enable row level security;

-- Users may read their own transcripts; writes are backend-only (service role).
drop policy if exists "capture transcripts: select own" on public.capture_transcripts;
create policy "capture transcripts: select own" on public.capture_transcripts
    for select to authenticated
    using (user_id = (select auth.uid()));
