import type { CurseType } from 'paw-core';

export interface GoldenWish {
  id: string;
  wish: string;
  context: string;
  expectedTypes: CurseType[];
}

export interface CurseQuality {
  id: string;
  type: CurseType;
  specific: boolean;
  reason: string;
}

export interface WishEvalResult {
  id: string;
  wish: string;
  curseCount: number;
  curses: CurseQuality[];
  typeCoverage: number;
  verdict: 'PASS' | 'FAIL';
}

export interface EvalResult {
  timestamp: string;
  wishes: WishEvalResult[];
  overallSpecificity: number;
  overallTypeCoverage: number;
  pass: boolean;
}
