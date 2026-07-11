/**
 * Tiny framework-free pub/sub holding the most recent density line profile
 * (RTV-32). The LineProfileTool completion handler pushes a profile here; the
 * LineProfilePanel subscribes and re-renders. Kept out of React so the tool
 * (which runs in the cornerstone event loop) has no React dependency.
 */
import type { ProfilePoint } from './lineProfile';

export interface LineProfileState {
  points: ProfilePoint[];
  modality?: string;
  unit?: string;
}

let current: LineProfileState = { points: [] };
const listeners = new Set<(s: LineProfileState) => void>();

export function getLineProfile(): LineProfileState {
  return current;
}

export function setLineProfile(state: LineProfileState): void {
  current = state;
  listeners.forEach(l => l(current));
}

export function subscribeLineProfile(listener: (s: LineProfileState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
