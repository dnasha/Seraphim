// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BrowserAlerts from '@/features/browser-geofence/BrowserAlerts';
import { readStore, storageKey } from '@/features/browser-geofence/store';
import { scope, news, json, id } from './fixtures/browserGeofence';
const bbox={minLat:0,maxLat:20,minLng:0,maxLng:20};
let prompts:ReturnType<typeof vi.fn>;
let delivered:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  localStorage.clear();prompts=vi.fn(async()=>{Object.defineProperty(Notification,'permission',{configurable:true,value:'granted'});return 'granted';});
  vi.stubGlobal('Notification',{permission:'default',requestPermission:prompts});vi.stubGlobal('isSecureContext',true);
  delivered=vi.fn(async()=>{});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_name:string,arg:unknown,callback?:()=>Promise<void>)=> typeof arg==='function'?arg():callback?.())}});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:vi.fn(async()=>({active:{},showNotification:delivered,getNotifications:vi.fn(async()=>[])}))}});
  vi.stubGlobal('fetch',vi.fn(async()=>json(news())));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function openAndSave(name='My private watch') {
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));
  fireEvent.change(screen.getByLabelText('New watch name'),{target:{value:name}});
  fireEvent.click(screen.getByRole('button',{name:'Save current viewport + filters'}));
  await screen.findByLabelText(`Rename ${name}`);
}
it('mounts without prompting, saves a local watch and establishes a quiet baseline only after explicit enable',async()=>{
  render(<BrowserAlerts account="A" bbox={bbox} scope={scope}/>);
  await openAndSave();expect(prompts).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Enable browser notifications'}));
  await waitFor(()=>expect(readStore(localStorage,'A').watches[0].checkpoint?.seen).toEqual([id(1)]));
  expect(prompts).toHaveBeenCalledOnce();expect(delivered).not.toHaveBeenCalled();
  const checkpoint=readStore(localStorage,'A').watches[0].checkpoint;
  fireEvent.click(screen.getByText('Review saved scope'));expect(readStore(localStorage,'A').watches[0].checkpoint).toEqual(checkpoint);
  fireEvent.change(screen.getByLabelText('Rename My private watch'),{target:{value:'Renamed'}});fireEvent.click(screen.getByRole('button',{name:'Rename'}));
  await screen.findByLabelText('Rename Renamed');expect(readStore(localStorage,'A').watches[0].checkpoint).toEqual(checkpoint);
  fireEvent.click(screen.getByRole('button',{name:'Delete Renamed'}));await waitFor(()=>expect(readStore(localStorage,'A').watches).toHaveLength(0));
});
it('isolates account changes and guests, clearing old private UI immediately on keyed replacement',async()=>{
  const {rerender}=render(<BrowserAlerts key="A" account="A" bbox={bbox} scope={scope}/>);await openAndSave();
  rerender(<BrowserAlerts key="B" account="B" bbox={bbox} scope={scope}/>);
  expect(screen.queryByDisplayValue('My private watch')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));expect(screen.queryByText('Review saved scope')).toBeNull();expect(prompts).not.toHaveBeenCalled();
  rerender(<BrowserAlerts key="guest" account={null} bbox={bbox} scope={scope}/>);fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));
  expect(screen.getByText(/Sign in to save/)).toBeTruthy();expect(screen.queryByRole('button',{name:'Enable browser notifications'})).toBeNull();
});
it('handles deletion from another tab and invalid data recovery',async()=>{
  localStorage.setItem(storageKey('A'),'corrupt');render(<BrowserAlerts account="A" bbox={bbox} scope={scope}/>);
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));fireEvent.click(screen.getByRole('button',{name:'Delete local watches and history'}));
  await waitFor(()=>expect(localStorage.getItem(storageKey('A'))).toBeNull());
  fireEvent.click(screen.getByRole('button',{name:'Save current viewport + filters'}));await screen.findByLabelText('Rename Viewport watch');
  await act(async()=>{localStorage.removeItem(storageKey('A'));window.dispatchEvent(new StorageEvent('storage',{key:storageKey('A')}));});
  expect(screen.queryByLabelText('Rename Viewport watch')).toBeNull();expect(prompts).not.toHaveBeenCalled();
});
it('shows quota and prevents saving unavailable viewports',async()=>{
  const {rerender}=render(<BrowserAlerts account="A" bbox={null} scope={scope}/>);
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));expect((screen.getByRole('button',{name:'Save current viewport + filters'}) as HTMLButtonElement).disabled).toBe(true);
  rerender(<BrowserAlerts account="A" bbox={bbox} scope={scope}/>);
  for(let i=1;i<=3;i++) {
    fireEvent.change(screen.getByLabelText('New watch name'),{target:{value:`Watch ${i}`}});fireEvent.click(screen.getByRole('button',{name:'Save current viewport + filters'}));await screen.findByLabelText(`Rename Watch ${i}`);
  }
  expect(readStore(localStorage,'A').watches).toHaveLength(3);expect((screen.getByRole('button',{name:'Save current viewport + filters'}) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps the shared scrape cadence when the user pauses and explicitly enables again',async()=>{
  render(<BrowserAlerts account="A" bbox={bbox} scope={scope}/>);await openAndSave();
  fireEvent.click(screen.getByRole('button',{name:'Enable browser notifications'}));
  await waitFor(()=>expect(readStore(localStorage,'A').watches[0].checkpoint).not.toBeNull());
  const nextCheckAt=readStore(localStorage,'A').nextCheckAt;
  fireEvent.click(screen.getByRole('button',{name:'Pause all checks'}));
  await waitFor(()=>expect(readStore(localStorage,'A').enabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Enable browser notifications'}));
  await waitFor(()=>expect(readStore(localStorage,'A').enabled).toBe(true));
  expect(readStore(localStorage,'A').nextCheckAt).toBe(nextCheckAt);
  expect(readStore(localStorage,'A').watches[0].checkpoint).toBeNull();
  expect(prompts).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
});

it('keeps the panel usable when acquiring localStorage throws SecurityError, without prompts or requests',async()=>{
  vi.spyOn(window,'localStorage','get').mockImplementation(()=>{throw new DOMException('Access denied','SecurityError');});
  const {rerender}=render(<BrowserAlerts key="A" account="A" bbox={bbox} scope={scope}/>);
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));
  expect(screen.getByRole('status').textContent).toMatch(/storage is unavailable/);
  expect((screen.getByRole('button',{name:'Save current viewport + filters'}) as HTMLButtonElement).disabled).toBe(true);
  expect(prompts).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  await act(async()=>{window.dispatchEvent(new Event('focus'));});
  expect(screen.getByRole('status').textContent).toMatch(/storage is unavailable/);
  rerender(<BrowserAlerts key="B" account="B" bbox={bbox} scope={scope}/>);
  fireEvent.click(screen.getByRole('button',{name:'Watch alerts'}));
  expect(screen.getByRole('status').textContent).toMatch(/storage is unavailable/);
  expect(prompts).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
