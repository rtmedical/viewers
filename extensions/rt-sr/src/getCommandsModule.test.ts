import { getCommandsModule } from './getCommandsModule';

describe('rt-sr getCommandsModule', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes downloadMeasurementSr + downloadCadRadsSr in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(['downloadCadRadsSr', 'downloadMeasurementSr']);
  });

  it('returns false for empty inputs (no dcmjs touched)', () => {
    expect(actions.downloadMeasurementSr({ measurements: [] })).toBe(false);
    expect(actions.downloadMeasurementSr()).toBe(false);
    expect(actions.downloadCadRadsSr()).toBe(false);
    expect(actions.downloadCadRadsSr({ assessment: { category: '' } })).toBe(false);
  });
});
