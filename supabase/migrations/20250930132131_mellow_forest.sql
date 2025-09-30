/*
  # Fix Authentication Issues and Super Admin Setup

  1. Database Fixes
    - Fix RLS policies that may be blocking authentication
    - Ensure proper service role permissions
    - Add missing indexes for performance
    - Fix profile creation triggers

  2. Super Admin Setup
    - Create super admin user if not exists
    - Ensure proper role assignment
    - Fix organization relationship

  3. Authentication Flow
    - Fix auth triggers
    - Ensure profile creation works
    - Add proper error handling
*/

-- First, let's check if we need to fix any RLS issues
-- Temporarily disable RLS on profiles for service role operations
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them properly
DROP POLICY IF EXISTS "users_read_own_profile" ON profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
DROP POLICY IF EXISTS "service_role_insert_profiles" ON profiles;
DROP POLICY IF EXISTS "service_role_update_profiles" ON profiles;
DROP POLICY IF EXISTS "super_admin_read_all_profiles" ON profiles;
DROP POLICY IF EXISTS "super_admin_update_all_profiles" ON profiles;
DROP POLICY IF EXISTS "org_admin_read_org_profiles" ON profiles;

-- Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create better RLS policies for profiles
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- Allow service role full access for auth operations
CREATE POLICY "profiles_service_role_all" ON profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Super admin can read all profiles
CREATE POLICY "profiles_super_admin_select_all" ON profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Super admin can update all profiles
CREATE POLICY "profiles_super_admin_update_all" ON profiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

-- Org admins can read profiles in their organization
CREATE POLICY "profiles_org_admin_select_org" ON profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('org_admin', 'manager')
      AND p.organization_id = profiles.organization_id
    )
  );

-- Fix the handle_new_user function to be more robust
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  user_role user_role := 'user';
  org_id uuid := NULL;
BEGIN
  -- Determine role based on email
  IF NEW.email = 'superadmin@workflowgene.cloud' THEN
    user_role := 'super_admin';
    org_id := NULL;
  ELSE
    user_role := 'user';
  END IF;

  -- Insert or update profile
  INSERT INTO profiles (
    id, 
    email, 
    role,
    organization_id,
    email_verified,
    first_name,
    last_name,
    created_at, 
    updated_at
  )
  VALUES (
    NEW.id, 
    NEW.email, 
    user_role,
    org_id,
    COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = NEW.email,
    email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, false),
    updated_at = now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the auth operation
    RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure super admin exists in auth.users
-- Note: This will only work if the super admin user has been created in Supabase Auth
DO $$
BEGIN
  -- Check if super admin profile exists
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE email = 'superadmin@workflowgene.cloud'
  ) THEN
    -- Insert super admin profile (assuming auth user exists)
    INSERT INTO profiles (
      id,
      email,
      first_name,
      last_name,
      role,
      organization_id,
      email_verified,
      is_active,
      created_at,
      updated_at
    ) 
    SELECT 
      id,
      email,
      'Super',
      'Admin',
      'super_admin'::user_role,
      NULL,
      true,
      true,
      now(),
      now()
    FROM auth.users 
    WHERE email = 'superadmin@workflowgene.cloud'
    ON CONFLICT (id) DO UPDATE SET
      role = 'super_admin'::user_role,
      organization_id = NULL,
      email_verified = true,
      first_name = 'Super',
      last_name = 'Admin',
      updated_at = now();
  ELSE
    -- Update existing super admin profile
    UPDATE profiles SET
      role = 'super_admin'::user_role,
      organization_id = NULL,
      email_verified = true,
      first_name = 'Super',
      last_name = 'Admin',
      is_active = true,
      updated_at = now()
    WHERE email = 'superadmin@workflowgene.cloud';
  END IF;
END $$;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_workflows_organization_id ON workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_activity_logs_organization_id ON activity_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);

-- Create a function to safely get user profile
CREATE OR REPLACE FUNCTION get_user_profile(user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  role user_role,
  organization_id uuid,
  email_verified boolean,
  is_active boolean,
  organization_name text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.first_name,
    p.last_name,
    p.role,
    p.organization_id,
    p.email_verified,
    p.is_active,
    o.name as organization_name
  FROM profiles p
  LEFT JOIN organizations o ON p.organization_id = o.id
  WHERE p.id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure auth schema permissions
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON auth.users TO service_role;

-- Create analytics table for dashboard metrics
CREATE TABLE IF NOT EXISTS analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  metric_type text NOT NULL,
  metric_value numeric,
  metadata jsonb DEFAULT '{}',
  recorded_at timestamptz DEFAULT now()
);

ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics_org_access" ON analytics
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND (
        p.role = 'super_admin'
        OR p.organization_id = analytics.organization_id
      )
    )
  );

-- Insert some sample analytics data for testing
INSERT INTO analytics (organization_id, metric_type, metric_value, metadata) VALUES
(NULL, 'system_metric', 99.9, '{"type": "uptime", "service": "api"}'),
(NULL, 'system_metric', 120, '{"type": "response_time", "service": "api"}'),
(NULL, 'system_metric', 50000, '{"type": "active_users"}');