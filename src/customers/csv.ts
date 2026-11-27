import type { CustomerListItem } from './customers.schemas.js';

const HEADERS = [
  'Nombre',
  'Teléfono',
  'Email',
  'Usuario',
  'Turnos',
  'Último turno',
  'Notas',
  'Consentimiento',
] as const;

/**
 * Quotes every cell and escapes leading formula characters so a customer can
 * not turn a note into a spreadsheet formula. Semicolons and the UTF-8 BOM
 * match the es-AR Excel import defaults.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  let text = String(value);

  if (/^[=+@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function customerCsv(items: readonly CustomerListItem[]): string {
  const lines = [
    HEADERS.join(';'),
    ...items.map((item) =>
      [
        item.name,
        item.phone,
        item.email,
        item.customerId ? 'Sí' : 'No',
        item.appointmentCount,
        item.lastAppointmentAt ?? '',
        item.notes,
        item.consentAt ? 'Sí' : 'No',
      ]
        .map(cell)
        .join(';'),
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
