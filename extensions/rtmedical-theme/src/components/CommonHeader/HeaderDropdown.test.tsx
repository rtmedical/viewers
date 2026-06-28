import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { HeaderDropdown } from './HeaderDropdown';

describe('HeaderDropdown', () => {
  const items = [
    { id: 'export', label: 'Exportar', onClick: jest.fn() },
    { id: 'report', label: 'Laudo', onClick: jest.fn() },
    { id: 'locked', label: 'Indisponível', onClick: jest.fn(), disabled: true },
  ];

  beforeEach(() => items.forEach(i => (i.onClick as jest.Mock).mockClear()));

  it('renders the trigger label and is closed by default', () => {
    render(<HeaderDropdown label="Tarefas" items={items} testId="t" />);
    expect(screen.getByText('Tarefas')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on trigger click and lists items', () => {
    render(<HeaderDropdown label="Tarefas" items={items} testId="t" />);
    fireEvent.click(screen.getByText('Tarefas'));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('Exportar')).toBeTruthy();
    expect(screen.getByText('Laudo')).toBeTruthy();
  });

  it('fires the item handler and closes on selection', () => {
    render(<HeaderDropdown label="Tarefas" items={items} testId="t" />);
    fireEvent.click(screen.getByText('Tarefas'));
    fireEvent.click(screen.getByText('Exportar'));
    expect(items[0].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not fire disabled items', () => {
    render(<HeaderDropdown label="Tarefas" items={items} testId="t" />);
    fireEvent.click(screen.getByText('Tarefas'));
    fireEvent.click(screen.getByText('Indisponível'));
    expect(items[2].onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<HeaderDropdown label="Tarefas" items={items} testId="t" />);
    fireEvent.click(screen.getByText('Tarefas'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside click', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <HeaderDropdown label="Tarefas" items={items} testId="t" />
      </div>
    );
    fireEvent.click(screen.getByText('Tarefas'));
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
