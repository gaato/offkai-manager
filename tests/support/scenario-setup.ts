import { vi } from 'vitest';
import { resetConfigForTests } from '$lib/server/config';
import { applicationId, generateSigningKey } from './interactions';

export const signingKey = await generateSigningKey();
vi.stubEnv('OFFKAI_AUTH_DEV_BYPASS', 'true');
vi.stubEnv('OFFKAI_DATABASE_PATH', ':memory:');
vi.stubEnv('OFFKAI_DISCORD_APPLICATION_ID', applicationId);
vi.stubEnv('OFFKAI_DISCORD_PUBLIC_KEY', signingKey.publicKeyHex);
vi.stubEnv('OFFKAI_PUBLIC_BASE_URL', 'https://example.test');
vi.stubEnv('OFFKAI_LOG_LEVEL', 'error');
resetConfigForTests();
