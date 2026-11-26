import { existsSync } from 'node:fs';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json plus the Firebase config Android push needs (google-services.json).
 * The file is not committed: EAS builds get it from the GOOGLE_SERVICES_JSON
 * file environment variable; locally it can sit at apps/mobile/google-services.json.
 * Without it the app still builds; phone notifications just can't register.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const file = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  return {
    ...config,
    android: { ...config.android, ...(existsSync(file) ? { googleServicesFile: file } : {}) },
  } as ExpoConfig;
};
