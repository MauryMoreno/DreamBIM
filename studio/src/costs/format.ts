// Format of amounts and quantities, and reading of numbers typed by the user.

/** Monedas del presupuesto. */
export const CURRENCIES = ['USD', 'EUR', 'MXN', 'COP', 'PEN', 'CLP', 'ARS', 'BRL', 'GBP'];

/** Amount in the currency of the document (en-US format, like the rest of the UI). */
export function money(currency: string, n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

const qty = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Cantidad con 2 decimales. */
export const quantity = (n: number): string => qty.format(n);

/** Number typed by the user: accepts a decimal comma or point. null if it is not a number (or is empty). */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
