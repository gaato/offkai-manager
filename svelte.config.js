import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true
  },
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'nonce',
      directives: {
        'default-src': ['self'],
        'base-uri': ['self'],
        'connect-src': ['self'],
        'font-src': ['self'],
        // Chrome applies form-action to post-submit redirects, so the Stripe
        // hosted surfaces we 303 to after form actions must be allowed here.
        'form-action': ['self', 'https://checkout.stripe.com', 'https://connect.stripe.com'],
        'frame-ancestors': ['none'],
        'img-src': ['self', 'data:'],
        'object-src': ['none'],
        'script-src': ['self'],
        'style-src': ['self']
      }
    }
  }
};

export default config;
