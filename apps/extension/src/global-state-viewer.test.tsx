import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobalStateViewer } from './global-state-viewer';

const state = {
  checkout: {
    total: 150,
    currency: 'RUB',
  },
  items: [
    { title: 'Cat food', available: true },
    { title: 'Toy', available: false },
  ],
  customer: 'Alice',
};

function rootHeader(): HTMLElement {
  const header = document.querySelector('.jer-collection-header-row');
  if (!(header instanceof HTMLElement)) throw new Error('Root state node was not rendered');
  return header;
}

function expandAll(): void {
  fireEvent.click(rootHeader(), { altKey: true });
}

describe('GlobalStateViewer', () => {
  afterEach(cleanup);

  it('starts collapsed and expands object and array nodes', async () => {
    render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');

    expect(screen.queryByText('checkout')).toBeNull();

    fireEvent.click(rootHeader());
    expect(screen.getByText('checkout')).toBeTruthy();
    expect(screen.queryByText('total')).toBeNull();

    fireEvent.click(screen.getByText('checkout'));
    expect(screen.getByText('total')).toBeTruthy();

    fireEvent.click(screen.getByText('items'));
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('is read-only while retaining copy controls', async () => {
    render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');
    expandAll();

    expect(document.querySelector('.jer-copy-pulse')).not.toBeNull();
    expect(screen.queryByTitle('Edit')).toBeNull();
    expect(screen.queryByTitle('Delete')).toBeNull();
    expect(screen.queryByTitle('Add')).toBeNull();
    expect(document.querySelector('[draggable="true"]')).toBeNull();
  });

  it('filters and reveals matching nodes by key or value', async () => {
    render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');
    const search = screen.getByRole('searchbox', { name: 'Search global state nodes' });

    fireEvent.change(search, { target: { value: 'CURR' } });
    await waitFor(() => expect(screen.getByText('currency')).toBeTruthy());
    expect(screen.queryByText('customer')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), {
      target: { value: 'value' },
    });
    fireEvent.change(search, { target: { value: 'alice' } });
    await waitFor(() => expect(screen.getByText(/Alice/)).toBeTruthy());
    expect(screen.queryByText('currency')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Search scope' }), {
      target: { value: 'key' },
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('No state nodes'));
  });

  it('restores expansion state after search is cleared', async () => {
    render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');
    fireEvent.click(rootHeader());
    fireEvent.click(screen.getByText('checkout'));
    expect(screen.getByText('total')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: 'Search global state nodes' });
    fireEvent.change(search, { target: { value: 'toy' } });
    await waitFor(() => expect(screen.getByText(/Toy/)).toBeTruthy());
    expect(screen.queryByText('total')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('total')).toBeTruthy());
    expect(screen.queryByText('Toy')).toBeNull();
  });

  it('preserves surviving expanded paths and prunes removed paths', async () => {
    const { rerender } = render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');
    fireEvent.click(rootHeader());
    fireEvent.click(screen.getByText('checkout'));

    rerender(<GlobalStateViewer state={{ ...state, checkout: { total: 200 } }} />);
    await waitFor(() => expect(screen.getByText('200')).toBeTruthy());

    rerender(<GlobalStateViewer state={{ replacement: { ready: true } }} />);
    await waitFor(() => expect(screen.getByText('replacement')).toBeTruthy());
    expect(screen.queryByText('ready')).toBeNull();

    rerender(<GlobalStateViewer state={{ checkout: { total: 300 } }} />);
    await waitFor(() => expect(screen.getByText('checkout')).toBeTruthy());
    expect(screen.queryByText('300')).toBeNull();
  });

  it('reports searches without matching nodes', async () => {
    render(<GlobalStateViewer state={state} />);
    await screen.findByText('state');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search global state nodes' }), {
      target: { value: 'does-not-exist' },
    });

    expect((await screen.findByRole('status')).textContent).toBe(
      'No state nodes match “does-not-exist”.',
    );
  });
});
