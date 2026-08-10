import { deriveServiceId, servicesToOffers } from '../utils/service-id';
import { type AgentCardService } from '../utils/agent-card';

describe('deriveServiceId', () => {
  it('slugs a plain name', () => {
    expect(deriveServiceId('Expense Report', [])).toBe('expense-report');
  });

  it('collapses punctuation and repeats, trims edges', () => {
    expect(deriveServiceId('  Tax   & Filing!! ', [])).toBe('tax-filing');
  });

  it('lowercases and strips leading/trailing dashes', () => {
    expect(deriveServiceId('--Hello--', [])).toBe('hello');
  });

  it('suffixes on collision', () => {
    expect(deriveServiceId('Expense Report', ['expense-report'])).toBe('expense-report-2');
    expect(deriveServiceId('Expense Report', ['expense-report', 'expense-report-2'])).toBe(
      'expense-report-3',
    );
  });

  it('falls back to service-<n> when the name slugs to empty', () => {
    expect(deriveServiceId('!!!', [])).toBe('service-1');
    expect(deriveServiceId('###', ['service-1'])).toBe('service-2');
  });

  it('always returns a value matching SERVICE_ID_REGEX', () => {
    const id = deriveServiceId('Über Ölçü 42', []);
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)).toBe(true);
  });
});

const svc = (over: Partial<AgentCardService> = {}): AgentCardService => ({
  id: 'expense-report',
  name: 'Expense Report',
  description: 'Builds an expense report',
  price: { amount: 5, currency: 'PAY' },
  deliverables: 'A PDF report',
  doneMeans: ['Reconciles to the ledger'],
  ...over,
});

describe('servicesToOffers', () => {
  it('maps a full service to a schema:Offer', () => {
    expect(servicesToOffers([svc()])).toEqual([
      {
        type: 'schema:Offer',
        identifier: 'expense-report',
        itemOffered: {
          type: 'schema:Service',
          name: 'Expense Report',
          description: 'Builds an expense report',
          serviceOutput: 'A PDF report',
        },
        priceSpecification: {
          type: 'schema:PriceSpecification',
          price: 5,
          priceCurrency: 'PAY',
        },
        'ixo:acceptanceCriteria': ['Reconciles to the ledger'],
      },
    ]);
  });

  it('omits serviceOutput and acceptanceCriteria when empty', () => {
    const [offer] = servicesToOffers([svc({ deliverables: '', doneMeans: [] })]);
    expect(offer?.itemOffered).not.toHaveProperty('serviceOutput');
    expect(offer).not.toHaveProperty('ixo:acceptanceCriteria');
  });

  it('returns one offer per service', () => {
    expect(servicesToOffers([svc(), svc({ id: 'x' })])).toHaveLength(2);
  });
});
