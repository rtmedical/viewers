/**
 * RTV-23 — HpEditorPanel behaviour: slot grid, series chips, HTML5 drop,
 * preview (addProtocol + setHangingProtocol command) and save/load/delete via
 * the RTV-24 HangingProtocolStore. ui-next/i18n are mocked so the test is
 * hermetic in jsdom.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('@ohif/ui-next', () => ({
  __esModule: true,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Input: (props: any) => <input {...props} />,
}));
jest.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
}));

import HpEditorPanel from './HpEditorPanel';
import { HangingProtocolStore, MemoryStorage } from '../hpPersistence/hpPersistence';
import { buildCustomProtocol } from './hpBuilder';

const UID = '1.2.840.99.1';

const makeDisplaySets = () => [
  {
    displaySetInstanceUID: 'ds-1',
    SeriesInstanceUID: UID,
    Modality: 'CT',
    SeriesDescription: 'AX Chest',
    SeriesNumber: 2,
    numImageFrames: 120,
  },
  {
    displaySetInstanceUID: 'ds-2',
    SeriesInstanceUID: '1.2.840.99.2',
    Modality: 'MR',
    SeriesDescription: 'T1',
    SeriesNumber: 3,
    numImageFrames: 40,
  },
  // Non image-bearing (e.g. SR) — must not become a chip.
  { displaySetInstanceUID: 'ds-3', SeriesInstanceUID: '1.2.840.99.3', Modality: 'SR', numImageFrames: 0 },
];

const setup = (overrides: { records?: Array<{ id: string; protocol: unknown }> } = {}) => {
  const store = new HangingProtocolStore({ storage: new MemoryStorage() });
  (overrides.records ?? []).forEach(r => store.save(r.id, r.protocol, 'seed'));
  const hangingProtocolService = {
    addProtocol: jest.fn(),
    addActiveProtocolId: jest.fn(),
    activeProtocolIds: ['rt-radiology-default'],
  };
  const displaySetService = { getActiveDisplaySets: () => makeDisplaySets() };
  const commandsManager = { runCommand: jest.fn() };
  const servicesManager = { services: { displaySetService, hangingProtocolService } } as any;
  const utils = render(
    <HpEditorPanel
      servicesManager={servicesManager}
      commandsManager={commandsManager as any}
      store={store}
    />
  );
  return { store, hangingProtocolService, commandsManager, ...utils };
};

const dropOnSlot = (slot: HTMLElement, payload: Record<string, unknown>) => {
  fireEvent.drop(slot, {
    dataTransfer: {
      getData: (type: string) =>
        type === 'application/x-rt-series' ? JSON.stringify(payload) : String(payload.seriesInstanceUID),
    },
  });
};

describe('HpEditorPanel', () => {
  it('renders the default 2x2 slot grid and image-bearing series chips only', () => {
    const { container } = setup();
    expect(container.querySelector('[data-cy="hp-editor"]')).toBeTruthy();
    const grid = container.querySelector('[data-cy="hp-editor-grid"]') as HTMLElement;
    expect(grid.querySelectorAll('[data-cy^="hp-editor-slot-"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-cy^="hp-editor-chip-"]')).toHaveLength(2);
    expect(screen.getByText('CT · AX Chest · #2')).toBeTruthy();
  });

  it('resizes the slot grid when rows/cols change', () => {
    const { container } = setup();
    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: '3' } }); // rows
    fireEvent.change(selects[1], { target: { value: '4' } }); // cols
    expect(
      container.querySelectorAll('[data-cy="hp-editor-grid"] [data-cy^="hp-editor-slot-"]')
    ).toHaveLength(12);
  });

  it('drop on a slot pins the series UID and preview builds/applies the protocol', () => {
    const { container, hangingProtocolService, commandsManager } = setup();
    const slot0 = container.querySelector('[data-cy="hp-editor-slot-0"]') as HTMLElement;
    dropOnSlot(slot0, { seriesInstanceUID: UID, modality: 'CT', description: 'AX Chest' });
    // The pinned series is shown on the slot (label resolved from the study).
    expect(within(slot0).getByText('CT · AX Chest · #2')).toBeTruthy();

    fireEvent.click(container.querySelector('[data-cy="hp-editor-preview"]')!);
    expect(hangingProtocolService.addProtocol).toHaveBeenCalledTimes(1);
    const [id, protocol] = hangingProtocolService.addProtocol.mock.calls[0];
    expect(id).toBe('rt-user-draft');
    expect((protocol as any).displaySetSelectors.slot0.seriesMatchingRules).toContainEqual({
      weight: 100,
      attribute: 'SeriesInstanceUID',
      constraint: { equals: { value: UID } },
    });
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setHangingProtocol', {
      protocolId: 'rt-user-draft',
      reset: true,
    });
    // Restricted active set is extended so the protocol participates in matching.
    expect(hangingProtocolService.addActiveProtocolId).toHaveBeenCalledWith('rt-user-draft');
  });

  it('refuses to save without a rule/name and saves once valid', () => {
    const { container, store } = setup();
    fireEvent.click(container.querySelector('[data-cy="hp-editor-save"]')!);
    expect(store.list()).toHaveLength(0);
    expect(container.textContent).toMatch(/matching rule/i);

    fireEvent.change(container.querySelector('[data-cy="hp-editor-name"]')!, {
      target: { value: 'Tórax 2x2' },
    });
    const slot0 = container.querySelector('[data-cy="hp-editor-slot-0"]') as HTMLElement;
    dropOnSlot(slot0, { seriesInstanceUID: UID });
    fireEvent.click(container.querySelector('[data-cy="hp-editor-save"]')!);

    const records = store.list();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('rt-user-torax-2x2');
    const list = container.querySelector('[data-cy="hp-editor-saved-list"]') as HTMLElement;
    expect(within(list).getByText('Tórax 2x2')).toBeTruthy();
  });

  it('lists saved protocols on mount, loads one into the editor, applies and deletes', () => {
    const protocol = buildCustomProtocol({
      id: 'meu-mr',
      name: 'Meu MR',
      rows: 1,
      cols: 3,
      slots: [{ modality: 'MR' }, {}, {}],
    });
    const { container, store, hangingProtocolService, commandsManager } = setup({
      records: [{ id: protocol.id, protocol }],
    });
    // Registered on mount so Apply/matching work in this session.
    expect(hangingProtocolService.addProtocol).toHaveBeenCalledWith('rt-user-meu-mr', protocol);

    const list = container.querySelector('[data-cy="hp-editor-saved-list"]') as HTMLElement;
    fireEvent.click(within(list).getByText('hp_load'));
    expect((container.querySelector('[data-cy="hp-editor-name"]') as HTMLInputElement).value).toBe(
      'Meu MR'
    );
    expect(
      container.querySelectorAll('[data-cy="hp-editor-grid"] [data-cy^="hp-editor-slot-"]')
    ).toHaveLength(3);

    fireEvent.click(within(list).getByText('hp_apply'));
    expect(commandsManager.runCommand).toHaveBeenCalledWith('setHangingProtocol', {
      protocolId: 'rt-user-meu-mr',
      reset: true,
    });

    fireEvent.click(within(list).getByText('hp_delete'));
    expect(store.list()).toHaveLength(0);
    expect(within(list).queryByText('Meu MR')).toBeNull();
  });

  it('edits slot rules manually and clears them', () => {
    const { container, hangingProtocolService } = setup();
    const slot1 = container.querySelector('[data-cy="hp-editor-slot-1"]') as HTMLElement;
    fireEvent.change(within(slot1).getByLabelText('hp_modality'), { target: { value: 'MR' } });
    fireEvent.change(within(slot1).getByPlaceholderText('hp_body_part'), {
      target: { value: 'HEAD' },
    });
    fireEvent.change(within(slot1).getByPlaceholderText('hp_series_desc'), {
      target: { value: 'FLAIR' },
    });

    fireEvent.click(container.querySelector('[data-cy="hp-editor-preview"]')!);
    const protocol: any = hangingProtocolService.addProtocol.mock.calls[0][1];
    const rules = protocol.displaySetSelectors.slot1.seriesMatchingRules;
    expect(rules).toContainEqual({
      weight: 20,
      attribute: 'Modality',
      constraint: { equals: { value: 'MR' } },
    });
    expect(rules).toContainEqual({
      weight: 15,
      attribute: 'BodyPartExamined',
      constraint: { equals: { value: 'HEAD' } },
    });
    expect(rules).toContainEqual({
      weight: 40,
      attribute: 'SeriesDescription',
      constraint: { containsI: { value: 'FLAIR' } },
    });
    // Modality union reaches the protocol matching rules.
    expect(protocol.protocolMatchingRules[0].constraint).toEqual({ containsAnyOf: ['MR'] });

    fireEvent.click(within(slot1).getByText('hp_clear'));
    fireEvent.click(container.querySelector('[data-cy="hp-editor-preview"]')!);
    const cleared: any = hangingProtocolService.addProtocol.mock.calls[1][1];
    expect(cleared.displaySetSelectors.slot1).toBeUndefined();
  });
});
