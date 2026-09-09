import type { Rarity } from '@auctioneer/shared';

export const RARITY_HEX: Record<Rarity, string> = {
  white: '#e2e8f0',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  gold: '#f59e0b',
  red: '#ef4444',
};

export function rarityStyle(rarity: Rarity): Record<string, string> {
  const c = RARITY_HEX[rarity];
  return {
    background: 'linear-gradient(135deg, ' + c + '2e 0%, ' + c + '14 100%)',
    borderColor: c,
  };
}
