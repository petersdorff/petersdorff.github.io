-- Migration: Add occupation column and storage policies
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Add occupation column to members
ALTER TABLE members ADD COLUMN IF NOT EXISTS occupation TEXT DEFAULT '';

-- 2. Storage policies for photos bucket
-- Allow authenticated users to upload photos
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'photos');

-- Allow authenticated users to update/overwrite their uploads
CREATE POLICY "Authenticated users can update photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'photos');

-- Allow authenticated users to delete photos
CREATE POLICY "Authenticated users can delete photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'photos');

-- Allow public read access (bucket is already public, but policy needed)
CREATE POLICY "Public read access for photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'photos');
