// Банк дома: счёт, журнал операций, админ-доступ
import type { InventoryRow } from './types';

export interface BankTx {
  id: string;
  at: number;
  /** starter | vendor | market_fee | market_sale | game | transfer | deposit */
  type: string;
  amount: number;
  balanceAfter: number;
  partyName: string | null;
  note: string | null;
}

export interface AdminBank {
  balance: number;
  inventory: InventoryRow[];
  inventoryValue: number;
  transactions: BankTx[];
}

export const BANK_TX_LABELS: Record<string, string> = {
  starter: 'Стартовый капитал',
  vendor: 'Покупка торговцем',
  market_fee: 'Комиссия барахолки',
  market_sale: 'Продажа предмета дома',
  game: 'Доход от партии',
  ante: 'Вступительные ставки',
  transfer: 'Выплата игроку',
  deposit: 'Пополнение банка',
  admin_item: 'Выдача предмета админом',
};
