-- ═══════════════════════════════════════════════════════════
-- STAMMBAUM – User Approvals Table
-- Run this in the Supabase SQL editor
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_approvals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_uid UUID NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID
);

-- Allow authenticated users to read their own approval status
ALTER TABLE user_approvals ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read their own row
CREATE POLICY "Users can read own approval" ON user_approvals
  FOR SELECT USING (auth.uid() = user_uid);

-- Anyone authenticated can insert their own approval request
CREATE POLICY "Users can create own approval" ON user_approvals
  FOR INSERT WITH CHECK (auth.uid() = user_uid);

-- Allow anon to read (for the admin deep link to work before login)
CREATE POLICY "Anon can read approvals" ON user_approvals
  FOR SELECT USING (true);

-- Admin can update any row (we check admin status in the app)
CREATE POLICY "Admin can update approvals" ON user_approvals
  FOR UPDATE USING (true);
