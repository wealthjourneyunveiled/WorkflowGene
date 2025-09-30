import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Icon from '../../components/AppIcon';
import { signIn } from '../../lib/auth';
import { useAuth } from '../../components/auth/AuthProvider';
import { testConnection } from '../../lib/supabase';
import toast from 'react-hot-toast';

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();

  const from = location.state?.from?.pathname || '/dashboard';

  useEffect(() => {
    // Redirect if already authenticated
    if (isAuthenticated && user) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, user, navigate, from]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Check if Supabase is configured
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        throw new Error('Supabase credentials not configured. Please check your .env file.');
      }

      // Test database connection first
      const connectionTest = await testConnection();
      if (!connectionTest.success) {
        throw new Error(`Database connection failed: ${connectionTest.error}`);
      }

      const result = await signIn(formData);
      
      if (result.success) {
        toast.success('Login successful!');
        console.log('Login successful for:', formData.email);
        // Small delay to allow auth state to update
        setTimeout(() => {
          // Role-based redirect
          if (formData.email === 'superadmin@workflowgene.cloud') {
            navigate('/dashboard', { replace: true });
          } else {
            navigate(from, { replace: true });
          }
        }, 500);
      } else {
        console.error('Login failed:', result.error);
        toast.error(result.error || 'Login failed. Please check your credentials.');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error(error.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Sign In - WorkflowGene Cloud</title>
        <meta name="description" content="Sign in to your WorkflowGene Cloud account to access your automation workflows and dashboard." />
      </Helmet>
      
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="text-center mb-8">
            <Link to="/homepage" className="inline-block mb-6">
              <img src="/assets/logos/WorkflowGene Logo.png" alt="WorkflowGene Cloud" className="h-12 mx-auto" />
            </Link>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Welcome Back</h1>
            <p className="text-text-secondary">Sign in to your WorkflowGene Cloud account</p>
          </div>

          {/* Login Form */}
          <div className="bg-card rounded-genetic-xl shadow-organic-lg p-8">
            {/* Environment Check Warning */}
            {(!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) && (
              <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-genetic-md">
                <div className="flex items-center space-x-2 mb-2">
                  <Icon name="AlertTriangle" size={16} className="text-error" />
                  <span className="font-semibold text-error">Configuration Error</span>
                </div>
                <p className="text-sm text-text-secondary">
                  Supabase credentials are missing. Please check your .env file configuration.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <Input
                label="Email Address"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="Enter your email"
                required
                autoComplete="email"
              />

              <div className="relative">
                <Input
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-9 text-text-secondary hover:text-text-primary"
                >
                  <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={20} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-2">
                  <input type="checkbox" className="rounded border-border" />
                  <span className="text-sm text-text-secondary">Remember me</span>
                </label>
                <Link 
                  to="/forgot-password" 
                  className="text-sm text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <Button
                type="submit"
                variant="default"
                size="lg"
                fullWidth
                loading={isSubmitting}
                disabled={!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY}
                iconName="LogIn"
                iconPosition="right"
                className="btn-organic"
              >
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-text-secondary">
                Don't have an account?{' '}
                <Link to="/signup" className="text-primary hover:underline font-medium">
                  Sign up for free
                </Link>
              </p>
            </div>
          </div>

          {/* Trust Indicators */}
          <div className="mt-8 text-center">
            <div className="flex items-center justify-center space-x-6 text-sm text-text-secondary">
              <div className="flex items-center space-x-2">
                <Icon name="Shield" size={16} className="text-success" />
                <span>SOC 2 Certified</span>
              </div>
              <div className="flex items-center space-x-2">
                <Icon name="Lock" size={16} className="text-success" />
                <span>256-bit Encryption</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;