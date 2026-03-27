import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../../../../..');
dotenvConfig({ path: join(rootDir, '.env') });

export const config = {
  // Server
  port: parseInt(process.env.UNIFIED_PORT || '3010', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  jwtExpiresIn: '90d',

  // Admin
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,

  // Database
  appDatabaseUrl: process.env.APP_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/app',

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

// Validate required config in production
if (config.isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('[Config] JWT_SECRET must be at least 32 characters in production');
    process.exit(1);
  }
}

export default config;
