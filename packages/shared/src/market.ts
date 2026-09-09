// Барахолка (p2p-рынок): комиссия, типы, срок жизни лотов
import type { InventoryRow, Rarity } from './types';

/** Комиссия дома с продажи на барахолке, % */
export const MARKET_FEE_PCT = 5;

/** Срок жизни лота на барахолке, дней */
export const MARKET_LISTING_DAYS = 7;

export const MARKET_LISTING_TTL_MS = MARKET_LISTING_DAYS * 24 * 60 * 60 * 1000;

/** Комиссия в валюте (округление вниз) */
export function marketFee(price: number): number {
  return Math.floor((price * MARKET_FEE_PCT) / 100);
}

export interface MarketListing {
  id: string;
  item: InventoryRow;
  sellerId: string;
  sellerName: string;
  price: number;
  createdAt: number;
  expiresAt: number;
  /** лот принадлежит текущему пользователю */
  mine: boolean;
}

/** Запись истории операций игрока на барахолке */
export interface MarketHistoryEntry {
  id: string;
  at: number;
  kind: 'buy' | 'sell' | 'vendor';
  itemName: string;
  rarity: Rarity;
  price: number;
  fee: number;
  counterpart: string;
}
