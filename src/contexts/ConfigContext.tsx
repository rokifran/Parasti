import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import type { AppConfig } from '../types';

// Defaults assume every module is enabled while the request is in flight, so
// the first render never hides a feature that turns out to be available.
const DEFAULT_CONFIG: AppConfig = {
  features: ['tasks', 'google'],
  timezone: 'Asia/Jakarta',
  googleConfigured: false,
};

interface ConfigContextValue {
  config: AppConfig;
  hasFeature: (name: string) => boolean;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let active = true;
    api.config.get()
      .then(res => {
        if (active) setConfig(res);
      })
      .catch(err => {
        // Keep the defaults: a failure here must not break the UI.
        console.warn('Could not load app config:', err);
      });
    return () => { active = false; };
  }, []);

  const hasFeature = (name: string) => config.features.includes(name);

  return (
    <ConfigContext.Provider value={{ config, hasFeature }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
