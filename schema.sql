-- ============================================================================
-- YUVA BHARAT FORMS ENGINE - DATABASE SCHEMA (forms & form_submissions ONLY)
-- Connects directly to existing YUVA Supabase database & existing event-banners storage
-- ============================================================================

-- 1. Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. FORMS SCHEMA TABLE (Stores dynamic form definitions created in Admin Builder)
CREATE TABLE IF NOT EXISTS public.forms (
    id TEXT PRIMARY KEY, -- Slug or unique ID string (e.g., 'vimarsh-2026-registration')
    event_id INTEGER REFERENCES public.events(id) ON DELETE SET NULL, -- References existing events table (INTEGER id)
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'General',
    banner_url TEXT,
    creator_name TEXT,
    creator_email TEXT,
    creator_phone TEXT,
    created_by_uploader UUID REFERENCES public.event_uploaders(id) ON DELETE SET NULL, -- References verified event uploader user
    schema_json JSONB NOT NULL DEFAULT '{"fields": []}'::jsonb,
    settings JSONB NOT NULL DEFAULT '{
        "allowMultiple": false,
        "requireAuth": false,
        "confirmationMessage": "Thank you for registering! Check your email for confirmation.",
        "redirectUrl": "",
        "maxSubmissions": 0,
        "closeDate": null,
        "sendEmailNotification": true
    }'::jsonb,
    is_approved BOOLEAN DEFAULT false NOT NULL, -- Verification pass flag from Advanced Admin
    is_active BOOLEAN DEFAULT true NOT NULL, -- Live vs Closed state flag
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Quick SQL Migration for existing tables:
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS creator_name TEXT;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS creator_email TEXT;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS creator_phone TEXT;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS created_by_uploader UUID REFERENCES public.event_uploaders(id) ON DELETE SET NULL;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false NOT NULL;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
-- ALTER TABLE public.forms ADD COLUMN IF NOT EXISTS approved_by TEXT;

-- Migration for event_uploaders full profile fields:
-- ALTER TABLE public.event_uploaders ADD COLUMN IF NOT EXISTS full_name TEXT;
-- ALTER TABLE public.event_uploaders ADD COLUMN IF NOT EXISTS phone TEXT;
-- ALTER TABLE public.event_uploaders ADD COLUMN IF NOT EXISTS role_in_yuva TEXT;

-- Safe Foreign Key Constraint (prevents cascading event deletions on uploader truncate/delete):
-- ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_created_by_uploader_fkey;
-- ALTER TABLE public.events ADD CONSTRAINT events_created_by_uploader_fkey FOREIGN KEY (created_by_uploader) REFERENCES public.event_uploaders(id) ON DELETE SET NULL;

-- Indexes for fast lookup by form_id, event_id, uploader, approval, and live status
CREATE INDEX IF NOT EXISTS idx_forms_event_id ON public.forms(event_id);
CREATE INDEX IF NOT EXISTS idx_forms_created_by_uploader ON public.forms(created_by_uploader);
CREATE INDEX IF NOT EXISTS idx_forms_creator_email ON public.forms(creator_email);
CREATE INDEX IF NOT EXISTS idx_forms_is_approved ON public.forms(is_approved);
CREATE INDEX IF NOT EXISTS idx_forms_is_active ON public.forms(is_active);

-- 3. FORM SUBMISSIONS TABLE (Stores participant responses)
CREATE TABLE IF NOT EXISTS public.form_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id TEXT NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES public.events(id) ON DELETE SET NULL, -- References existing events table (INTEGER id)
    participant_name TEXT,
    participant_email TEXT,
    participant_phone TEXT,
    responses_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    files_json JSONB DEFAULT '[]'::jsonb,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'submitted', -- submitted, verified, rejected, waitlist
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Indexes for querying submissions
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_id ON public.form_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_event_id ON public.form_submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_email ON public.form_submissions(participant_email);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created_at ON public.form_submissions(created_at DESC);

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;

-- Forms Policies:
-- Allow anyone to read active forms
DROP POLICY IF EXISTS "Public Read Forms" ON public.forms;
CREATE POLICY "Public Read Forms" 
ON public.forms FOR SELECT 
TO anon, authenticated 
USING (true);

-- Allow creating / updating forms from Admin interface
DROP POLICY IF EXISTS "Public Manage Forms" ON public.forms;
CREATE POLICY "Public Manage Forms" 
ON public.forms FOR ALL 
TO anon, authenticated 
USING (true)
WITH CHECK (true);

-- Form Submissions Policies:
-- Allow public participants to submit responses
DROP POLICY IF EXISTS "Public Insert Submissions" ON public.form_submissions;
CREATE POLICY "Public Insert Submissions" 
ON public.form_submissions FOR INSERT 
TO anon, authenticated 
WITH CHECK (true);

-- Allow viewing submissions
DROP POLICY IF EXISTS "Public Read Submissions" ON public.form_submissions;
CREATE POLICY "Public Read Submissions" 
ON public.form_submissions FOR SELECT 
TO anon, authenticated 
USING (true);

-- ============================================================================
-- 5. CASCADE DELETION SETUP: EVENT -> FORMS
-- Deleting an event will automatically delete its linked registration form schema
-- ============================================================================
ALTER TABLE public.forms DROP CONSTRAINT IF EXISTS forms_event_id_fkey;
ALTER TABLE public.forms ADD CONSTRAINT forms_event_id_fkey 
    FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- ============================================================================
-- 6. SUPABASE STORAGE BUCKET CONFIGURATION (event-banners)
-- ============================================================================

-- Ensure the 'event-banners' bucket is marked public
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-banners', 'event-banners', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Remove broad SELECT policy to eliminate the Supabase dashboard listing warning.
-- (Public buckets do NOT need a SELECT policy on storage.objects; files are publicly accessible via direct URL)
DROP POLICY IF EXISTS "Public Storage Read" ON storage.objects;
DROP POLICY IF EXISTS "Give users access to own folder" ON storage.objects;

-- Allow public uploads (Event Banners & Form Attachments)
DROP POLICY IF EXISTS "Public Storage Upload" ON storage.objects;
CREATE POLICY "Public Storage Upload"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'event-banners');

-- ============================================================================
-- 7. USEFUL STORAGE CLEANUP COMMANDS (Run manually in Supabase SQL Editor)
-- ============================================================================

-- Command A: Delete all old event banners only (KEEPING all attendee attachments intact):
-- DELETE FROM storage.objects WHERE bucket_id = 'event-banners' AND name LIKE 'banners/%';

-- Command B: Delete all form attachments of a specific deleted form:
-- DELETE FROM storage.objects WHERE bucket_id = 'event-banners' AND name LIKE 'form-attachments/<form_id>/%';

-- Command C: Completely clear all files in the event-banners bucket:
-- DELETE FROM storage.objects WHERE bucket_id = 'event-banners';


