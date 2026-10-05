/**
 * Keyword screen for the optional styling note. Photos may show children (a
 * parent with their kid), so anything sexual or suggestive is refused before
 * it reaches the image model. The model's own safety filter is the second
 * layer; this one just stops the obvious attempts early.
 */

export const DIRECTION_BLOCKED = 'DIRECTION_BLOCKED';

// Whole-word matches (English / Spanish / Portuguese) on normalized text.
const WORDS = [
  'sex',
  'sexy',
  'sexual',
  'sexualized',
  'nude',
  'nudes',
  'nudity',
  'naked',
  'topless',
  'bottomless',
  'nsfw',
  'porn',
  'porno',
  'xxx',
  'erotic',
  'erotica',
  'seductive',
  'seduce',
  'seducing',
  'sensual',
  'provocative',
  'suggestive',
  'lingerie',
  'underwear',
  'panties',
  'thong',
  'bra',
  'braless',
  'bikini',
  'cleavage',
  'busty',
  'boob',
  'boobs',
  'tits',
  'titties',
  'nipple',
  'nipples',
  'butt',
  'booty',
  'ass',
  'twerk',
  'twerking',
  'stripper',
  'striptease',
  'undress',
  'undressed',
  'undressing',
  'fetish',
  'bdsm',
  'bondage',
  'kinky',
  'lewd',
  'horny',
  'aroused',
  'orgasm',
  'flirty',
  'flirting',
  'onlyfans',
  'hentai',
  'loli',
  'lolita',
  'shota',
  'jailbait',
  // es / pt
  'desnudo',
  'desnuda',
  'desnudos',
  'desnudas',
  'nua',
  'nuas',
  'pelada',
  'lenceria',
  'tanga',
  'calzones',
  'pezon',
  'pezones',
  'tetas',
  'culo',
  'erotico',
  'provocativo',
  'provocativa',
  'sensuales',
  'biquini',
  'calcinha',
  'sutia',
];

// Multi-word phrases, matched on normalized text with single spaces.
const PHRASES = [
  'see through',
  'wet t shirt',
  'lap dance',
  'pole dance',
  'make out',
  'making out',
  'spread legs',
  'no clothes',
  'without clothes',
  'take off clothes',
  'ropa interior',
  'roupa intima',
  'sin ropa',
  'sem roupa',
];

// Letters spelled out with gaps ("s e x y", "p.o.r.n") — compacted check for
// the highest-signal words only, to keep false positives rare.
const COMPACT = [
  'sexy',
  'porn',
  'nsfw',
  'naked',
  'topless',
  'lingerie',
  'twerk',
];

// Chinese has no word boundaries: plain substring match. Avoid bare 裸/乳/成人
// /黄色, which also appear in harmless notes (裸色, 乳白色, 黄色背景).
const ZH = [
  '性感',
  '色情',
  '情色',
  '裸体',
  '全裸',
  '半裸',
  '裸露',
  '裸照',
  '露点',
  '露胸',
  '走光',
  '内衣',
  '内裤',
  '丁字裤',
  '比基尼',
  '情趣',
  '诱惑',
  '挑逗',
  '调情',
  '脱衣',
  '脱光',
  '床戏',
  '翘臀',
  '电臀',
  '屁股',
  '胸部',
  '乳房',
  '乳头',
  '透视装',
  '萝莉',
  '正太',
  '18禁',
  '成人内容',
  '色色',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

const wordRe = new RegExp(`\\b(?:${WORDS.join('|')})\\b`);

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z一-鿿]+/g, ' ')
    .trim();
}

/** True when the styling note asks for sexual or suggestive content. */
export function isBlockedDirection(direction?: string) {
  if (!direction?.trim()) return false;
  if (ZH.some((w) => direction.includes(w))) return true;
  const text = normalize(direction);
  if (wordRe.test(text)) return true;
  const spaced = ` ${text} `;
  if (PHRASES.some((p) => spaced.includes(` ${p} `))) return true;
  const compact = text.replace(/ /g, '');
  return COMPACT.some((w) => compact.includes(w));
}
