import type { IStripeConnectInitParams, StripeConnectInstance } from '@stripe/connect-js';

/** Resolve DaisyUI's active theme to sRGB: Connect accepts hex/RGB/HSL, not OKLCH or var(). */
export function connectAppearance(
  host: HTMLElement
): NonNullable<IStripeConnectInitParams['appearance']> {
  const style = getComputedStyle(host);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot resolve Connect theme colors');
  const color = (token: string) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue(`--color-${token}`).trim();
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const background = color('base-100');
  const text = color('base-content');
  const primary = color('primary');
  const secondary = color('base-200');
  return {
    variables: {
      colorBackground: background,
      colorText: text,
      colorSecondaryText: text,
      colorPrimary: primary,
      colorDanger: color('error'),
      colorBorder: color('base-300'),
      buttonPrimaryColorBackground: primary,
      buttonPrimaryColorText: color('primary-content'),
      buttonSecondaryColorBackground: secondary,
      buttonSecondaryColorText: text,
      actionSecondaryColorText: text,
      formBackgroundColor: background,
      offsetBackgroundColor: secondary
    }
  };
}

/** System theme changes must reach already-mounted Stripe iframes too. */
export function followConnectTheme(connect: StripeConnectInstance, host: HTMLElement): () => void {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => connect.update({ appearance: connectAppearance(host) });
  preference.addEventListener('change', update);
  // Loading Stripe may span a theme change; read the current tokens once more.
  update();
  return () => preference.removeEventListener('change', update);
}
