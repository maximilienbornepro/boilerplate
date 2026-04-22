import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../../../../..');
// Use override:true so .env values take precedence over any empty env vars
// (macOS may pre-define some keys as empty strings)
dotenvConfig({ path: join(rootDir, '.env'), override: true });

export const config = {
  // Server
  port: parseInt(process.env.UNIFIED_PORT || '3010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  // 7 days with sliding refresh would be the proper fix, but changing
  // the TTL alone doesn't invalidate existing tokens. Dropping from
  // 90d → 30d is the minimum we can do without breaking current
  // sessions in a disruptive way.
  jwtExpiresIn: '30d',

  // Admin
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,

  // Database
  appDatabaseUrl: process.env.APP_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/app',

  // Fathom OAuth (https://developers.fathom.ai/sdks/oauth)
  fathom: {
    oauth: {
      clientId: process.env.FATHOM_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.FATHOM_OAUTH_CLIENT_SECRET || '',
      redirectUri: process.env.FATHOM_OAUTH_CALLBACK_URL || 'http://localhost:3010/api/auth/fathom/callback',
    },
  },

  // Outlook OAuth (Microsoft Graph)
  outlook: {
    oauth: {
      clientId: process.env.OUTLOOK_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.OUTLOOK_OAUTH_CLIENT_SECRET || '',
      redirectUri: process.env.OUTLOOK_OAUTH_CALLBACK_URL || 'http://localhost:3010/api/auth/outlook/callback',
    },
  },

  // Gmail OAuth (Google)
  gmail: {
    oauth: {
      clientId: process.env.GMAIL_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET || '',
      redirectUri: process.env.GMAIL_OAUTH_CALLBACK_URL || 'http://localhost:3010/api/auth/gmail/callback',
    },
  },

  // Jira (optional - for OAuth connector)
  jira: {
    baseUrl: process.env.JIRA_BASE_URL || '',
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    oauth: {
      clientId: process.env.JIRA_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.JIRA_OAUTH_CLIENT_SECRET || '',
      redirectUri: process.env.JIRA_OAUTH_CALLBACK_URL || 'http://localhost:3010/api/auth/jira/callback',
    },
  },
};

// Validate required config at startup. The hardcoded dev fallback
// `dev-secret-change-in-production` lets us boot in a fresh clone
// without ceremony, but we refuse to run with it in any non-dev env.
if (config.isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('[Config] JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
} else if (process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'test') {
  if (!process.env.JWT_SECRET) {
    console.error('[Config] JWT_SECRET is required outside development (NODE_ENV=' + process.env.NODE_ENV + ')');
    process.exit(1);
  }
}

export default config;
