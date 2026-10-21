/** Query values only build an allowlisted Discord URL; these pages perform no settlement. */
export function discordReturnUrl(url: URL) {
  const guild = url.searchParams.get('guild') ?? '';
  const channel = url.searchParams.get('channel') ?? '';
  return /^\d{17,20}$/.test(guild) && /^\d{17,20}$/.test(channel)
    ? `https://discord.com/channels/${guild}/${channel}`
    : 'https://discord.com/channels/@me';
}
