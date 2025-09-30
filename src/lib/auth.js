// src/lib/auth.js
import { supabase, isSupabaseConfigured, clearInvalidSession } from './supabase';
import toast from 'react-hot-toast';

// ✅ Get the current user session with error handling
export const getCurrentUser = async () => {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, returning null user');
    return null;
  }
  
  try {
    const { data: { session } = {}, error } = await supabase.auth.getSession();
    
    if (error) {
      console.warn('Auth session error:', error.message);
      
      // Handle invalid refresh token
      if (error.message?.includes('refresh_token_not_found') || 
          error.message?.includes('Invalid Refresh Token')) {
        await clearInvalidSession();
        return null;
      }
      
      return null;
    }
    
    return session?.user || null;
  } catch (error) {
    console.warn('Error getting current user:', error.message);
    return null;
  }
};

// ✅ Get user profile from database with retry logic
export const getCurrentProfile = async () => {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, returning null profile');
    return null;
  }
  
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select(`
        *,
        organization:organizations(*)
      `)
      .eq('id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Profile doesn't exist, create it
        console.log('Creating missing profile for user:', user.email);
        
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            email_verified: !!user.email_confirmed_at,
            role: user.email === 'superadmin@workflowgene.cloud' ? 'super_admin' : 'user',
            first_name: user.user_metadata?.first_name || '',
            last_name: user.user_metadata?.last_name || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.error('Error creating profile:', insertError);
          return null;
        }

        // Retry fetching the profile
        const { data: newProfile, error: fetchError } = await supabase
          .from('profiles')
          .select(`
            *,
            organization:organizations(*)
          `)
          .eq('id', user.id)
          .single();

        if (fetchError) {
          console.error('Error fetching new profile:', fetchError);
          return null;
        }

        return newProfile;
      }
      
      console.error('Profile fetch error:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error getting current profile:', error);
    return null;
  }
};

// ✅ Sign in user with improved error handling
export const signIn = async ({ email, password }) => {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Authentication service not configured. Please check your Supabase configuration.' };
  }

  try {
    // Clear any existing invalid sessions first
    await clearInvalidSession();

    console.log('Attempting login for:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    
    if (error) {
      console.error('Sign in error:', error);
      
      // Handle specific database errors
      if (error.message?.includes('Database error granting user')) {
        return { 
          success: false, 
          error: 'Database connection issue. Please try again later or contact support if the problem persists.' 
        };
      }
      
      if (error.message?.includes('Invalid login credentials')) {
        return { success: false, error: 'Invalid email or password. Please check your credentials and try again.' };
      }
      
      return { success: false, error: error.message || 'Login failed. Please try again.' };
    }
    
    console.log('Auth successful, user:', data.user?.email);

    // Update last login timestamp
    if (data.user) {
      try {
        await supabase
          .from('profiles')
          .update({ 
            last_login: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', data.user.id);
      } catch (updateError) {
        console.warn('Could not update last login:', updateError);
        // Don't fail the login for this
      }
    }
    
    return { success: true, data };
  } catch (error) {
    console.error('Sign in error:', error);
    return { success: false, error: error.message };
  }
};

// ✅ Sign up user with improved organization handling
export const signUp = async ({ email, password, firstName, lastName, organizationName, industry, companySize }) => {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Authentication service not configured. Please check your Supabase configuration.' };
  }

  try {
    // Clear any existing sessions
    await clearInvalidSession();

    // First, sign up the user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName
        }
      }
    });

    if (authError) {
      console.error('Sign up error:', authError);
      
      if (authError.message?.includes('Database error')) {
        return { 
          success: false, 
          error: 'Database connection issue. Please try again later or contact support if the problem persists.' 
        };
      }
      
      return { success: false, error: authError.message || 'Signup failed. Please try again.' };
    }

    if (authData.user) {
      // Create organization if provided
      let organizationId = null;
      if (organizationName?.trim()) {
        try {
          const { data: orgData, error: orgError } = await supabase
            .from('organizations')
            .insert({
              name: organizationName.trim(),
              slug: organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              industry: industry,
              company_size: companySize,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();

          if (orgError) {
            console.error('Organization creation error:', orgError);
          } else {
            organizationId = orgData.id;
          }
        } catch (orgError) {
          console.warn('Could not create organization:', orgError);
        }
      }

      // Update or create profile with additional information
      try {
        // Determine role based on email and organization
        let userRole = 'user';
        if (email.trim() === 'superadmin@workflowgene.cloud') {
          userRole = 'super_admin';
          organizationId = null; // Super admin doesn't belong to any org
        } else if (organizationId) {
          userRole = 'org_admin'; // First user in org becomes admin
        }

        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id: authData.user.id,
            email: email.trim(),
            first_name: firstName,
            last_name: lastName,
            organization_id: organizationId,
            role: userRole,
            email_verified: !!authData.user.email_confirmed_at,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'id'
          });

        if (profileError) {
          console.error('Profile update error:', profileError);
        }
      } catch (profileError) {
        console.warn('Could not update profile:', profileError);
      }
    }
    
    return { success: true, data: authData };
  } catch (error) {
    console.error('Sign up error:', error);
    return { success: false, error: error.message };
  }
};

// ✅ Sign out user
export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // Clear any cached data
    await clearInvalidSession();
    
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
};

// ✅ Request a password reset
export const resetPassword = async (email) => {
  if (!isSupabaseConfigured()) {
    throw new Error('Authentication service not configured');
  }

  try {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`
    });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Password reset error:', error);
    return { success: false, error: error.message };
  }
};

// ✅ Update password
export const updatePassword = async (newPassword) => {
  try {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    
    if (error) throw error;
    toast.success('Password updated successfully');
    return { success: true, data };
  } catch (error) {
    console.error('Password update error:', error);
    toast.error('Failed to update password');
    return { success: false, error: error.message };
  }
};

// ✅ Update profile
export const updateProfile = async (profileData) => {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("No authenticated user");

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...profileData,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    toast.success('Profile updated successfully');
    return { success: true, data };
  } catch (error) {
    console.error("Update profile error:", error);
    toast.error('Failed to update profile');
    return { success: false, error: error.message };
  }
};

// ✅ Ensure super admin exists
export const ensureSuperAdmin = async () => {
  if (!isSupabaseConfigured()) return;

  try {
    console.log('Ensuring super admin exists...');
    
    // Check if super admin profile exists
    const { data: existingProfile, error: checkError } = await supabase
      .from('profiles')
      .select('id, role, email, first_name, last_name')
      .eq('email', 'superadmin@workflowgene.cloud')
      .maybeSingle();

    if (checkError) {
      console.error('Error checking super admin:', checkError);
      return;
    }

    console.log('Existing super admin profile:', existingProfile);

    // If profile exists but role is wrong, update it
    if (existingProfile && existingProfile.role !== 'super_admin') {
      console.log('Updating super admin role...');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ 
          role: 'super_admin',
          email_verified: true,
          first_name: 'Super',
          last_name: 'Admin',
          organization_id: null,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('email', 'superadmin@workflowgene.cloud');

      if (updateError) {
        console.error('Error updating super admin role:', updateError);
      } else {
        console.log('Super admin role updated');
      }
    } else if (existingProfile) {
      console.log('Super admin profile already exists with correct role');
    }
  } catch (error) {
    console.error('Error ensuring super admin:', error);
  }
};