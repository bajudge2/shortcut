import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jakeabrams.shortcut.hack2026', // must match the Bundle Identifier in Xcode (unique for signing)
  appName: 'Shortcut',
  webDir: 'dist',
};

export default config;
