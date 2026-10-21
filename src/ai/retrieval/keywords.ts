/**
 * Rule-based query terms for program prefetch. No word segmentation service: a small
 * continuity-cue lexicon picks up states that later prose most often contradicts
 * (injuries, body parts, weapons, life and death, captivity, location), and expands
 * each cue to its related and recovery terms so a later "已经痊愈" is retrieved together
 * with the earlier injury.
 */
import { foldCase } from './matcher';

interface CueGroup { cues: readonly string[]; expand: readonly string[]; }
const INJURY = ['受伤', '伤势', '伤口', '重伤', '旧伤', '负伤', '包扎', '骨折', '残废', '痊愈', '康复', '恢复', '好转', '养伤', '疗伤', '治好', '复原'];
const GROUPS: readonly CueGroup[] = [
  { cues: ['左手', '右手', '双手', '单手', '两手', '手臂', '左臂', '右臂', '胳膊', '手腕', '手指', '握', '抓'], expand: ['左手', '右手', '双手', '手臂', '左臂', '右臂', '握剑', '握不住', ...INJURY] },
  { cues: ['左腿', '右腿', '双腿', '腿', '脚踝', '膝盖', '跑', '奔', '跳', '走路', '骑马'], expand: ['左腿', '右腿', '双腿', '膝盖', '瘸', '走不了', ...INJURY] },
  { cues: ['左眼', '右眼', '双眼', '眼睛', '看见', '看清', '目光', '失明'], expand: ['左眼', '右眼', '双眼', '失明', '看不见', ...INJURY] },
  { cues: ['耳朵', '听见', '听到', '失聪', '嗓子', '说话', '开口', '哑'], expand: ['耳朵', '失聪', '嗓子', '哑', '说不出话', ...INJURY] },
  { cues: ['剑', '刀', '枪', '弓', '箭', '武器', '兵器', '法杖', '拔剑', '握剑', '出剑', '挥剑', '出刀'], expand: ['握剑', '拔剑', '佩剑', '断剑', '失去', '丢了', '折断', '左手', '右手', '双手', ...INJURY] },
  { cues: ['中毒', '毒', '昏迷', '发烧', '病', '咳血', '吐血', '内伤'], expand: ['中毒', '解毒', '昏迷', '醒来', '病', '内伤', ...INJURY] },
  { cues: ['死', '尸体', '葬', '复活', '活着', '亡', '牺牲', '阵亡', '去世'], expand: ['死了', '死去', '身亡', '去世', '阵亡', '尸体', '复活', '活着', '没死'] },
  { cues: ['关押', '囚禁', '牢', '被捕', '逃出', '越狱', '锁链'], expand: ['关押', '囚禁', '牢', '被捕', '逃出', '越狱', '释放'] },
  { cues: ['戒指', '玉佩', '令牌', '信物', '钥匙', '地图', '书信'], expand: ['戒指', '玉佩', '令牌', '信物', '钥匙', '丢失', '失去', '交给', '送给'] },
];
const QUOTED = /[「“『"]([^」”』"\n]{2,12})[」”』"]/gu;

/**
 * Keywords for a writing selection or analysis block. Order: cues literally present
 * first, then expansions, then quoted terms from the author's request; capped.
 */
export function extractKeywords(text: string, authorRequest = '', limit = 16): string[] {
  const folded = foldCase(text);
  const present: string[] = [], expanded: string[] = [];
  for (const group of GROUPS) {
    const hits = group.cues.filter(cue => folded.includes(cue));
    if (!hits.length) continue;
    present.push(...hits);
    expanded.push(...group.expand);
  }
  const quoted: string[] = [];
  for (const match of authorRequest.matchAll(QUOTED)) quoted.push(match[1].trim());
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of [...quoted, ...present, ...expanded]) {
    if (!term || seen.has(term)) continue;
    seen.add(term); result.push(term);
    if (result.length >= limit) break;
  }
  return result;
}

const CJK = /[㐀-鿿豈-﫿]/u;
const COMMON = new Set(['一个', '自己', '他们', '我们', '你们', '什么', '没有', '这个', '那个', '不是', '就是', '已经', '还是', '可以', '知道', '时候', '起来', '出来', '一下', '这样', '那样', '因为', '所以', '但是', '如果', '只是', '一样', '现在', '然后', '之后', '之前', '这里', '那里', '一声', '一眼']);
/** Distinct CJK bigrams (excluding very common function pairs) for cheap overlap ranking. */
export function bigrams(text: string, limit = 4000): Set<string> {
  const result = new Set<string>();
  const folded = foldCase(text);
  for (let i = 0; i + 1 < folded.length && result.size < limit; i++) {
    const a = folded[i], b = folded[i + 1];
    if (!CJK.test(a) || !CJK.test(b)) continue;
    const pair = a + b;
    if (!COMMON.has(pair)) result.add(pair);
  }
  return result;
}
