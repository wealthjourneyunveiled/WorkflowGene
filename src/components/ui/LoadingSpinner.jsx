import React from 'react';
import Icon from '../AppIcon';

const LoadingSpinner = ({ size = 'default', message = 'Loading...' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    default: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className={`${sizeClasses[size]} mx-auto mb-4 animate-spin text-primary`}>
          <Icon name="Loader2" size={size === 'sm' ? 16 : size === 'lg' ? 48 : size === 'xl' ? 64 : 32} />
        </div>
        <p className="text-text-secondary">{message}</p>
        
        {/* Debug info for development */}
        {import.meta.env.DEV && (
          <div className="mt-4 text-xs text-text-secondary">
            <p>Supabase URL: {import.meta.env.VITE_SUPABASE_URL ? '✅ Set' : '❌ Missing'}</p>
            <p>Anon Key: {import.meta.env.VITE_SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoadingSpinner;