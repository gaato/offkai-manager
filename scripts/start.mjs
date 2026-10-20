// Production entry point: `node scripts/start.mjs`.
//
// adapter-node captures ORIGIN at module import time (before hooks run), so
// mapping OFFKAI_PUBLIC_BASE_URL onto it must happen before build/index.js is
// imported. Without ORIGIN, SvelteKit's built-in CSRF check rejects every
// same-origin form POST with 403. HOST/PORT mapping stays in
// applyAdapterAddress (src/lib/server/config.ts), which runs early enough.
if (!process.env.ORIGIN) {
  try {
    process.env.ORIGIN = new URL(
      process.env.OFFKAI_PUBLIC_BASE_URL || 'http://127.0.0.1:8080'
    ).origin;
  } catch {
    // Leave ORIGIN unset; config.ts fails fast with a proper message.
  }
}

await import('../build/index.js');
