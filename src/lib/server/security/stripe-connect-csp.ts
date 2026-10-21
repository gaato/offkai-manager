// https://docs.stripe.com/connect/get-started-connect-embedded-components#csp-and-http-header-requirements
// The documented parent connect-src additions apply only to custom font URLs.
const sources: Record<string, string[]> = {
  'script-src': ['https://connect-js.stripe.com', 'https://js.stripe.com'],
  'frame-src': ['https://connect-js.stripe.com', 'https://js.stripe.com'],
  'img-src': ['https://*.stripe.com'],
  'style-src': ["'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='"]
};

export function stripeConnectCsp(policy: string): string {
  const directives = new Map(
    policy
      .split(';')
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.trim().split(/\s+/);
        return [name, values] as const;
      })
  );
  for (const [name, additions] of Object.entries(sources)) {
    // Preserve SvelteKit's per-response nonces and the default-src fallback.
    const existing = directives.get(name) ?? directives.get('default-src') ?? [];
    directives.set(name, [...new Set([...existing, ...additions])]);
  }
  return [...directives].map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}
