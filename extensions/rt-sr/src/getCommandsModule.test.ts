import { getCommandsModule } from './getCommandsModule';

describe('rt-sr getCommandsModule', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes downloadMeasurementSr in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions)).toEqual(['downloadMeasurementSr']);
  });

  it('returns false for an empty measurement list (no dcmjs touched)', () => {
    expect(actions.downloadMeasurementSr({ measurements: [] })).toBe(false);
    expect(actions.downloadMeasurementSr()).toBe(false);
  });
});
