/** Defuses spreadsheet formulas while preserving the cell's visible text. */
export function neutralizeCSVCell(value: string): string {
  if (!value) return value;
  return ['=', '+', '-', '@', '\t', '\r', '\n'].includes(value[0]) ? `'${value}` : value;
}

export function encodeCSV(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map(encodeCSVCell).join(','))
    .map((row) => `${row}\r\n`)
    .join('');
}

function encodeCSVCell(raw: string): string {
  const value = neutralizeCSVCell(raw);
  return /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
