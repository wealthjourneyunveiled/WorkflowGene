// store/authStore.js
import { create } from 'zustand';
import { supabase, isSupabaseConfigured, clearInvalidSession } from '../lib/supabase';
import { getCurrentProfile } from '../lib/auth';

const useAuthStore = create((set, get) => ({
  // State
  user: null,
  profile: null,
  loading: true,
  initialized: false,
  error: null,

  // Actions
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // Initialize auth state
  initialize: async () => {
    if (!isSupabaseConfigured()) {
      console.warn('Supabase not configured, skipping auth initialization');
      set({
        user: null,
        profile: null,
        loading: false,
        initialized: true,
        error: 'Supabase not configured'
      });
      return;
    }

    try {
      set({ loading: true, error: null });

      console.log('Initializing auth state...');

      // Get current session with error handling
      const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.warn('Session error:', sessionError.message);
        
        // If refresh token is invalid, clear the session
        if (sessionError.message?.includes('refresh_token_not_found') || 
            sessionError.message?.includes('Invalid Refresh Token')) {
          await clearInvalidSession();
          set({
            user: null,
            profile: null,
            loading: false,
            initialized: true,
            error: null
          });
          return;
        }
        
        throw sessionError;
      }

      const user = session?.user || null;
      console.log('Current user from session:', user?.email);
      let profile = null;

      if (user) {
        try {
          console.log('Fetching profile for user:', user.email);
          
          // Get profile with retry logic
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount < maxRetries) {
            try {
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
                  console.log('Creating profile for user:', user.email);
                  
                  // Determine role based on email
                  const userRole = user.email === 'superadmin@workflowgene.cloud' ? 'super_admin' : 'user';
                  
                  const { error: insertError } = await supabase
                    .from('profiles')
                    .insert({
                      id: user.id,
                      email: user.email,
                      email_verified: !!user.email_confirmed_at,
                      role: userRole,
                      first_name: user.user_metadata?.first_name || '',
                      last_name: user.user_metadata?.last_name || '',
                      organization_id: userRole === 'super_admin' ? null : undefined,
                      is_active: true,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString()
                    });

                  if (insertError) {
                    console.error('Error creating profile:', insertError);
                    throw insertError;
                  }
                  
                  // Retry fetching the profile
                  retryCount++;
                  continue;
                }
                throw error;
              }

              profile = data;
              console.log('Profile loaded:', { email: profile.email, role: profile.role });
              break;
            } catch (retryError) {
              retryCount++;
              if (retryCount >= maxRetries) {
                throw retryError;
              }
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }

          // Special handling for super admin
          if (user.email === 'superadmin@workflowgene.cloud' && profile?.role !== 'super_admin') {
            console.log('Updating super admin role...');
            const { error: updateError } = await supabase
              .from('profiles')
              .update({
                role: 'super_admin',
                email_verified: true,
                first_name: 'Super',
                last_name: 'Admin',
                organization_id: null, // Super admin doesn't belong to any org
                is_active: true,
                updated_at: new Date().toISOString()
              })
              .eq('id', user.id);

            if (updateError) {
              console.error('Error updating super admin:', updateError);
            } else {
              // Refetch profile
              const { data: updatedProfile } = await supabase
                .from('profiles')
                .select(`
                  *,
                  organization:organizations(*)
                `)
                .eq('id', user.id)
                .single();
              profile = updatedProfile;
              console.log('Super admin role updated:', profile?.role);
            }
          }

        } catch (profileError) {
          console.error('Profile error:', profileError);
          // Don't fail completely, just log the error
          profile = null;
        }
      }

      console.log('Auth initialized:', { 
        userEmail: user?.email, 
        profileRole: profile?.role,
        profileId: profile?.id 
      });

      set({
        user,
        profile,
        loading: false,
        initialized: true,
        error: null
      });

    } catch (error) {
      console.error('Auth initialization error:', error);
      set({
        user: null,
        profile: null,
        loading: false,
        initialized: true,
        error: error.message
      });
    }
  },

  // Refresh profile data
  refreshProfile: async () => {
    const { user } = get();
    if (!user) return null;

    try {
      const profile = await getCurrentProfile();
      set({ profile });
      return profile;
    } catch (error) {
      console.error('Profile refresh error:', error);
      return null;
    }
  },

  // Clear auth state
  clearAuth: () => set({
    user: null,
    profile: null,
    loading: false,
    error: null
  }),

  // Check if user has required role
  hasRole: (requiredRoles) => {
    const { profile } = get();
    if (!profile?.role) return false;
    return Array.isArray(requiredRoles)
      ? requiredRoles.includes(profile.role)
      : profile.role === requiredRoles;
  },

  // Check if user can access organization data
  canAccessOrganization: (organizationId) => {
    const { profile } = get();
    if (!profile) return false;
    if (profile.role === 'super_admin') return true;
    return profile.organization_id === organizationId;
  },

  // Get user permissions
  getPermissions: () => {
    const { profile } = get();
    if (!profile?.role) return {};

    const permissions = {
      super_admin: {
        canManageUsers: true,
        canManageOrganizations: true,
        canManageWorkflows: true,
        canViewAnalytics: true,
        canManageBilling: true,
        canManageSettings: true,
        canAccessAllData: true,
        canAccessCMS: true,
        canManageSystem: true,
        canManageIntegrations: true,
        canViewSystemHealth: true,
        canManageErrorLogs: true
      },
      org_admin: {
        canManageUsers: true,
        canManageOrganizations: false,
        canManageWorkflows: true,
        canViewAnalytics: true,
        canManageBilling: true,
        canManageSettings: true,
        canAccessAllData: false,
        canAccessCMS: false,
        canManageSystem: false,
        canManageIntegrations: true,
        canViewSystemHealth: false,
        canManageErrorLogs: false
      },
      manager: {
        canManageUsers: false,
        canManageOrganizations: false,
        canManageWorkflows: true,
        canViewAnalytics: true,
        canManageBilling: false,
        canManageSettings: false,
        canAccessAllData: false,
        canAccessCMS: false,
        canManageSystem: false,
        canManageIntegrations: true,
        canViewSystemHealth: false,
        canManageErrorLogs: false
      },
      user: {
        canManageUsers: false,
        canManageOrganizations: false,
        canManageWorkflows: false,
        canViewAnalytics: false,
        canManageBilling: false,
        canManageSettings: false,
        canAccessAllData: false,
        canAccessCMS: false,
        canManageSystem: false,
        canManageIntegrations: false,
        canViewSystemHealth: false,
        canManageErrorLogs: false
      }
    };

    return permissions[profile.role] || permissions.user;
  }
}));

// Supabase auth state listener with error handling
if (isSupabaseConfigured()) {
  supabase.auth.onAuthStateChange(async (event, session) => {
    const { setUser, setProfile, clearAuth, refreshProfile } = useAuthStore.getState();

    console.log('Auth state change:', event, session?.user?.email);

    try {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user);
        await refreshProfile();
      } else if (event === 'SIGNED_OUT') {
        clearAuth();
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user);
      }
    } catch (error) {
      console.error('Auth state change error:', error);
      if (error.message?.includes('refresh_token_not_found')) {
        await clearInvalidSession();
        clearAuth();
      }
    }
  });
}

export default useAuthStore;