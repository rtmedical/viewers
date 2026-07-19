import { getCommandsModule } from './getCommandsModule';

describe('getCommandsModule (rt-print)', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes computeRtPrintLayout + rtPrint in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(['computeRtPrintLayout', 'rtPrint']);
  });

  it('computeRtPrintLayout returns a layout for the given config', () => {
    const layout = actions.computeRtPrintLayout({ config: { paper: 'A4', grid: '2x2' } });
    expect(layout.zones).toHaveLength(4);
    expect(layout.paper).toBe('A4');
  });
});
