import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for the Play-Store build (phase 5).
 * Workflow:
 *   npm run build          # produces dist/
 *   npx cap add android    # once, creates the android/ project
 *   npx cap sync android   # copy dist/ + plugins into the native project
 *   npx cap open android   # build/run via Android Studio
 */
const config: CapacitorConfig = {
  appId: 'de.burgspiel.app',
  appName: 'Burgspiel',
  webDir: 'dist',
  android: {
    backgroundColor: '#141821',
  },
};

export default config;
