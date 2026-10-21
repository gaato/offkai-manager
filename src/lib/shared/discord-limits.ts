// Wire limits belong in code so stored settings cannot create invalid Discord payloads.
export const discordLimits = {
  messageComponents: 40,
  messageText: 4_000,
  modalComponents: 5,
  customId: 100,
  buttonsPerRow: 5,
  textInput: 4_000,
  selectOptions: 25,
  checkboxOptions: 10
} as const;
