import React from "react";
import { useEffect } from 'react';
import Routes from "./Routes";
import { initGA } from './lib/analytics';
import { Toaster } from 'react-hot-toast';
import PWAInstaller from './components/pwa/PWAInstaller';
import OfflineIndicator from './components/pwa/OfflineIndicator';
import { isSupabaseConfigured } from './lib/supabase';

function App() {
  useEffect(() => {
    // Check Supabase configuration on app start
    if (!isSupabaseConfigured()) {
      console.error('Supabase is not properly configured. Please check your environment variables.');
    }

    // Initialize Google Analytics
    initGA();

    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('SW registered: ', registration);
          })
          .catch((registrationError) => {
            console.log('SW registration failed: ', registrationError);
          });
      });
    }
  }, []);

  return (
    <>
      <Routes />
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            duration: 3000,
            theme: {
              primary: '#4aed88',
            },
          },
        }}
      />
      <PWAInstaller />
      <OfflineIndicator />
    </>
  );
}

export default App;
