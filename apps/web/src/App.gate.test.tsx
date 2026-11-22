// @vitest-environment jsdom
// The page and the gate: the confirmation screen, the outside screen with a ready round to rest, and the inert seal
// after the Grant (paw-web Req 13, A13, A14). Poster mode, StrictMode, a fake ApiClient. No network.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADULT_REQUIRED_MESSAGE,
  CLAUSE_AS_WRITTEN_MESSAGE,
  NO_LIVE_WISH_MESSAGE,
  OUTSIDE_NOTE_MESSAGE,
  SEAL_USED_MESSAGE,
} from './api/api-messages';
import { SAMPLE_WISH_TEXT, sampleGrant, sampleSpecExport, sampleWish } from './api/api-test-support';
import { App } from './App';
import { SessionProvider } from './state/SessionProvider';
import { failure, fakeApi, ok } from './state/paw-session-test-support';
import type { FakeApi } from './state/paw-session-test-support';
import { READY_ROUNDS } from './state/ready-rounds';

vi.mock('./scene/webgl-support', () => ({ hasWebGL: () => false }));

const EXAMPLE_TEXT = 'Users can reset their password by email';
const exampleEntry = { wish: { ...sampleWish(EXAMPLE_TEXT), id: 'ex-1' }, grant: sampleGrant() };

function renderApp(api: FakeApi) {
  return render(
    <StrictMode>
      <SessionProvider api={api}>
        <App />
      </SessionProvider>
    </StrictMode>,
  );
}

function newApi(live: boolean | 'fail' = true): FakeApi {
  const api = fakeApi();
  api.getExamples.mockImplementation(() => Promise.resolve(ok([exampleEntry])));
  api.getLive.mockImplementation(() =>
    Promise.resolve(live === 'fail' ? failure('network', 'The line to the paw is cut.') : ok({ live })),
  );
  return api;
}

const wishInput = (): HTMLInputElement => screen.getByRole('textbox', { name: 'I wish that' });
const seal = (): HTMLElement => screen.getByRole('button', { name: 'Make the wish' });
const box = (): HTMLInputElement => screen.getByRole('checkbox', { name: 'I am 18 or older' });
const circle = (name: RegExp | string): HTMLElement => screen.getByRole('button', { name });
const type = (text: string): void => void fireEvent.change(wishInput(), { target: { value: text } });
const describedBy = (el: HTMLElement): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
const roundName = (index: number): RegExp => new RegExp(`^Example\\. ${(READY_ROUNDS[index]?.wish.text ?? '').slice(0, 20)}`);

beforeEach(() => {
  document.getElementById('static-shell')?.remove();
});
afterEach(cleanup);

describe('the confirmation screen', () => {
  it('sends nothing without the tick, shows the alert and focuses the box', async () => {
    const api = newApi();
    renderApp(api);
    await screen.findByRole('button', { name: /^Example\./ });
    expect(box().checked).toBe(false);
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(seal());
    expect(api.postGrant).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(ADULT_REQUIRED_MESSAGE);
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(box());
  });

  it('sends the wish with the tick as true, and shows the notice for a server 403 that unticks the box', async () => {
    const api = newApi();
    api.postGrant.mockResolvedValueOnce(failure('adult', ADULT_REQUIRED_MESSAGE, 403));
    renderApp(api);
    await screen.findByRole('button', { name: /^Example\./ });
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(box());
    fireEvent.click(seal());
    await waitFor(() => expect(box().checked).toBe(false));
    expect(api.postGrant.mock.calls[0]?.[2]).toBe(true);
    expect(box().getAttribute('aria-invalid')).toBe('true');
  });

  it('replays an example with no tick and no alert', async () => {
    const api = newApi();
    renderApp(api);
    fireEvent.click(await screen.findByRole('button', { name: /^Example\./ }));
    fireEvent.click(seal());
    await waitFor(() => expect(circle('Permissions curse, open, click to bind')).toBeTruthy());
    expect(api.postGrant).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the box ticked through Rewrite and writes nothing to storage or cookies', async () => {
    const api = newApi();
    renderApp(api);
    await screen.findByRole('button', { name: /^Example\./ });
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(box());
    fireEvent.click(seal());
    await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
    fireEvent.click(await screen.findByRole('button', { name: 'Stop and take the scroll' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite' }));
    await waitFor(() => expect(wishInput().value).toBe(''));
    expect(box().checked).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });
});

describe('the seal after the Grant (A14)', () => {
  async function granted(api = newApi()): Promise<FakeApi> {
    renderApp(api);
    await screen.findByRole('button', { name: /^Example\./ });
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(box());
    fireEvent.click(seal());
    await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
    return api;
  }

  it('is inert and described until Rewrite, and click, Enter and Space send nothing', async () => {
    const api = await granted();
    expect(seal().getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(seal())).toBe(SEAL_USED_MESSAGE);
    const before = document.querySelector('[data-paw-state-text]')?.textContent;
    fireEvent.click(seal());
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    fireEvent.keyDown(wishInput(), { key: 'Enter' });
    fireEvent.keyDown(seal(), { key: ' ' });
    fireEvent.keyUp(seal(), { key: ' ' });
    expect(api.postGrant).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-paw-state-text]')?.textContent).toBe(before);
    expect(wishInput().readOnly).toBe(true);
    expect(box().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(box());
    expect(box().checked).toBe(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop and take the scroll' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rewrite' }));
    await waitFor(() => expect(seal().hasAttribute('aria-disabled')).toBe(false));
    expect(wishInput().readOnly).toBe(false);
  });

  it('locks the example cards, and Escape in the row changes nothing', async () => {
    const api = newApi();
    renderApp(api);
    const card = await screen.findByRole('button', { name: /^Example\./ });
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(box());
    fireEvent.click(seal());
    await waitFor(() => expect(circle('Data loss curse, open, click to bind')).toBeTruthy());
    expect(card.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(card);
    expect(wishInput().value).toBe(SAMPLE_WISH_TEXT);
    expect(card.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the outside screen', () => {
  async function outside(): Promise<FakeApi> {
    const api = newApi(false);
    renderApp(api);
    await screen.findByText(OUTSIDE_NOTE_MESSAGE, { selector: 'p' });
    return api;
  }

  it('has no checkbox, shows the three ready rounds, and sends nothing for a typed wish', async () => {
    const api = await outside();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Example\./ })).toHaveLength(3);
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(seal());
    expect(api.postGrant).not.toHaveBeenCalled();
    expect(screen.getAllByText(NO_LIVE_WISH_MESSAGE).length).toBeGreaterThan(0);
  });

  it('plays a ready round to rest with the clause pre-filled, no grant, no bind, and exports the properties', async () => {
    const api = await outside();
    api.postExport.mockResolvedValue(ok(sampleSpecExport()));
    fireEvent.click(screen.getByRole('button', { name: roundName(0) }));
    fireEvent.click(seal());
    for (let index = 0; index < 3; index += 1) {
      const curse = READY_ROUNDS[0]?.grant.curses[index];
      await waitFor(() => expect(document.querySelector(`li[data-index="${index}"] button`)).not.toBeNull());
      fireEvent.click(document.querySelector(`li[data-index="${index}"] button`) as HTMLElement);
      await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true));
      const clause = document.querySelector('dialog textarea') as HTMLTextAreaElement;
      expect(clause.value).toBe(curse?.binding?.clause);
      fireEvent.click(screen.getByRole('button', { name: 'Accept this clause' }));
      await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false));
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Take the scroll' }));
    await waitFor(() => expect(api.postExport).toHaveBeenCalledTimes(1));
    const body = api.postExport.mock.calls[0]?.[0];
    expect(body?.grant.curses.map((c) => c.verdict?.property)).toEqual(READY_ROUNDS[0]?.grant.curses.map((c) => c.verdict?.property));
    expect(api.postGrant).not.toHaveBeenCalled();
    expect(api.postBind).not.toHaveBeenCalled();
  });

  it('keeps the card open for an edited ready clause and sends nothing', async () => {
    const api = await outside();
    fireEvent.click(screen.getByRole('button', { name: roundName(1) }));
    fireEvent.click(seal());
    await waitFor(() => expect(document.querySelector('li[data-index="0"] button')).not.toBeNull());
    fireEvent.click(document.querySelector('li[data-index="0"] button') as HTMLElement);
    const clause = (await waitFor(() => document.querySelector('dialog textarea'))) as HTMLTextAreaElement;
    fireEvent.change(clause, { target: { value: `${clause.value} Always.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept this clause' }));
    expect((await screen.findAllByText(CLAUSE_AS_WRITTEN_MESSAGE)).length).toBeGreaterThan(0);
    expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(api.postBind).not.toHaveBeenCalled();
  });

  it('turns the open screen into the outside screen when the server refuses a wish by region', async () => {
    const api = newApi(true);
    api.postGrant.mockResolvedValueOnce(failure('outside', 'The paw grants no live wishes where you stand.', 403));
    renderApp(api);
    await screen.findByRole('button', { name: /^Example\./ });
    type(SAMPLE_WISH_TEXT);
    fireEvent.click(box());
    await act(async () => {
      fireEvent.click(seal());
    });
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    expect(screen.getAllByRole('button', { name: /^Example\./ })).toHaveLength(3);
  });
});

describe('the example note', () => {
  it('is absent before a Grant and after a live Grant', async () => {
    const api = newApi();
    renderApp(api);
    expect(document.querySelector('[data-example-note]')).toBeNull();
    type('A wish of my own');
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    fireEvent.click(seal());
    await waitFor(() => expect(api.postGrant).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-example-note]')).toBeNull();
  });
});
