import { ITEM_CATALOG } from '@auctioneer/shared';

// имя предмета -> defId (для компонентов, где defId не передаётся, напр. PublicItem на доске)
const NAME_TO_DEF: Record<string, string> = Object.fromEntries(
  ITEM_CATALOG.map((d) => [d.name, d.id] as const),
);

const ICON_URLS = import.meta.glob('../assets/items/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** URL иконки предмета каталога по defId (или по имени как фолбэк) */
export function itemIconUrl(defId?: string, name?: string): string | undefined {
  const id = defId ?? (name ? NAME_TO_DEF[name] : undefined);
  if (!id) return undefined;
  return ICON_URLS['../assets/items/' + id + '.png'];
}

/** Определение каталога по defId (для диапазона цены в подсказке) */
export function catalogDef(defId?: string, name?: string) {
  const id = defId ?? (name ? NAME_TO_DEF[name] : undefined);
  if (!id) return undefined;
  return ITEM_CATALOG.find((d) => d.id === id);
}
