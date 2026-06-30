import { getCommandsModule } from './getCommandsModule';

describe('measurements getCommandsModule', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes the 4 calculators in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(
      ['computeAgatston', 'computeCobbAngle', 'computeHuStats', 'computeSuvBw'].sort()
    );
  });

  it('computeCobbAngle / computeAgatston / computeHuStats delegate to the pure fns', () => {
    expect(actions.computeCobbAngle({ line1: [[0, 0], [10, 0]], line2: [[0, 0], [10, 10]] })).toBe(45);
    expect(actions.computeAgatston({ lesions: [{ areaMm2: 5, maxHu: 250 }] }).total).toBe(10);
    expect(actions.computeHuStats({ values: [10, 20, 30] }).mean).toBe(20);
  });

  it('computeSuvBw returns null when factor inputs are insufficient', () => {
    expect(actions.computeSuvBw({ values: [1], patientWeightKg: 0, injectedDoseBq: 1, halfLifeSec: 1 })).toBeNull();
  });
});
