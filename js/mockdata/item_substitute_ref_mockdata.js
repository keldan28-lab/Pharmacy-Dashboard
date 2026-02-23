window.ITEM_SUBSTITUTE_REF = {
  version: '2026-02-23',
  source: 'manual_reference',
  items: {
    '32156': {
      substitutes: [
        { itemCode: '54651', relationship: 'formulation_alt', priority: 1 },
        { itemCode: '32456', relationship: 'dose_strength', priority: 2 }
      ],
      notes: 'Dose conversion may be required.'
    },
    '2365': {
      substitutes: [
        { itemCode: '3587', relationship: 'dose_strength', priority: 1 },
        { itemCode: '65421', relationship: 'therapeutic_alt', priority: 2 }
      ]
    },
    '32154': { substitutes: null },
    '54651': {
      substitutes: [
        { itemCode: '32156', relationship: 'formulation_alt', priority: 1 }
      ]
    }
  }
};
