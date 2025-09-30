import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase Config:', {
  url: supabaseUrl,
  hasAnonKey: !!supabaseAnonKey,
  anonKeyLength: supabaseAnonKey?.length
});

// Create Supabase client with fallback handling
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      debug: false
    },
    global: {
      headers: {
        'X-Client-Info': 'workflowgene-cloud'
      }
    }
  }
);

// Check if Supabase is properly configured
export const isSupabaseConfigured = () => {
  const configured = !!(supabaseUrl && supabaseAnonKey && 
    supabaseUrl !== 'https://placeholder.supabase.co' && 
    supabaseAnonKey !== 'placeholder-key');
  
  if (!configured) {
    console.error('❌ Supabase Configuration Missing!');
    console.error('Please add your Supabase credentials to the .env file:');
    console.error('VITE_SUPABASE_URL=your-project-url');
    console.error('VITE_SUPABASE_ANON_KEY=your-anon-key');
  }
  
  return configured;
};

// Clear invalid sessions
export const clearInvalidSession = async () => {
  try {
    await supabase.auth.signOut();
    localStorage.removeItem('supabase.auth.token');
    sessionStorage.removeItem('supabase.auth.token');
    // Clear all auth-related localStorage items
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('sb-') || key.includes('supabase')) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.warn('Error clearing session:', error);
  }
};

// Test database connection
export const testConnection = async () => {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Database connection test failed:', error);
    return { success: false, error: error.message };
  }
};