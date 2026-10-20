import { vi } from 'vitest';

// Freeze Date alone: timers and asynchronous gateway barriers still run normally.
vi.useFakeTimers({ toFake: ['Date'] });

vi.setSystemTime(new Date('2026-10-21T00:00:00.000Z'));
