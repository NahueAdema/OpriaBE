import { describe, expect, it } from 'vitest';
import { customerCsv } from './csv.js';
import type { CustomerListItem } from './customers.schemas.js';

const item: CustomerListItem = {
  phone: '+54 11 5555 0000',
  name: 'Ana "La Loca" Pérez',
  email: 'ana@example.com',
  customerId: null,
  profileId: '2c2f2a4e-9a6a-4c1d-9a9f-8f2a1f0d9c11',
  notes: 'Prefiere turnos a la tarde; =SUM(A1:A9)',
  consentAt: '2026-11-20T12:00:00.000Z',
  appointmentCount: 3,
  lastAppointmentAt: '2026-11-25T15:00:00.000Z',
};

describe('customerCsv', () => {
  it('uses an es-AR friendly header with BOM and semicolon separator', () => {
    const csv = customerCsv([item]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')[0]).toContain('Nombre;Teléfono;Email');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('escapes quotes, newlines and spreadsheet formulas', () => {
    const csv = customerCsv([{ ...item, notes: '=1+1\r\n"hola"' }]);

    expect(csv).toContain(`"'=1+1\r\n""hola"""`);
    expect(csv).not.toContain('"=1+1');
  });

  it('renders missing optional values as empty cells', () => {
    const csv = customerCsv([
      {
        ...item,
        email: null,
        notes: null,
        consentAt: null,
        lastAppointmentAt: null,
      },
    ]);

    expect(csv).toContain(';;"No";"3";;;"No"');
  });

  it('handles an empty list with just the heading', () => {
    expect(customerCsv([])).toBe(
      '\uFEFFNombre;Teléfono;Email;Usuario;Turnos;Último turno;Notas;Consentimiento\r\n',
    );
  });
});
