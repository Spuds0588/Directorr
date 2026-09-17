/**
 * Teleprompter — pacing math and the canvas painter.
 *
 * Two audiences read the same text, and they must not be confused:
 *
 *   the TALENT   needs a prompt: scrolling, paced to their clip, never recorded
 *                (see src/components/Teleprompter.jsx for that overlay)
 *   the AUDIENCE gets whatever the creator chooses to burn into the composite
 *                (this module, used by Engine A's caption band)
 *
 * Keeping the math here means both paths scroll identically and a creator's
 * reading pace is estimated from the same source of truth as the scroll speed.
 */

import { wrapText } from './mediaUtils.js';

export const DEFAULT_WPM = 150; // conversational narration pace

export const DEFAULT_PROMPT_THEME = {
  font: 'Arial',
  fontSize: 44,
  textColor: '#FFFFFF',
  backgroundColor: 'rgba(0,0,0,0.55)',
};

/** Words per minute a comfortable narrator actually reads at. */
export function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function estimateReadingSeconds(text, wordsPerMinute = DEFAULT_WPM) {
  return (countWords(text) / wordsPerMinute) * 60;
}

/**
 * How well a prompt fits its slot. This is the feedback that makes a template
 * honest: a creator writing 120 words into a 20-second clip is asking the talent
 * to read at 360 wpm, which is not a thing a person can do.
 */
export function paceFor(text, durationSeconds, wordsPerMinute = DEFAULT_WPM) {
  const words = countWords(text);
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  if (!words) return { verdict: 'empty', words: 0, seconds, neededSeconds: 0, targetWpm: 0, message: 'No prompt yet.' };

  const neededSeconds = estimateReadingSeconds(text, wordsPerMinute);
  const targetWpm = seconds > 0 ? (words / seconds) * 60 : 0;
  const base = `${words} word${words === 1 ? '' : 's'} ≈ ${neededSeconds.toFixed(1)}s at ${wordsPerMinute} wpm`;
  const slot = seconds > 0 ? ` — this clip is ${seconds.toFixed(1)}s (${targetWpm.toFixed(0)} wpm).` : '.';

  let verdict = 'fits';
  let advice = ' Comfortable.';
  if (targetWpm > 220) {
    verdict = 'fast';
    advice = ` Too fast to sound natural — cut about ${Math.max(1, Math.round(words - (seconds * 200) / 60))} words, or lengthen the clip.`;
  } else if (targetWpm > 180) {
    verdict = 'tight';
    advice = ' Tight but readable if the talent is brisk.';
  } else if (targetWpm < 80 && seconds >= 3) {
    verdict = 'room';
    advice = ' There is room for more — the talent will be waiting on the clock.';
  }

  return { verdict, words, seconds, neededSeconds, targetWpm, message: `${base}${slot}${advice}` };
}

/**
 * Paint a scrolling prompt / caption band onto a canvas.
 *
 * Identical maths to the DOM overlay: the block scrolls from its first line to
 * its last across `progress` 0 -> 1, so a creator's script lands on the audience
 * at the same rate it lands on the talent.
 */
export function drawTeleprompter(ctx, { text, rect, progress = 0, theme = {}, guide = true } = {}) {
  const style = { ...DEFAULT_PROMPT_THEME, ...theme };
  const { x, y, width, height } = rect;
  const padding = 40;
  const fontSize = Number(style.fontSize) || 44;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.fillStyle = style.backgroundColor || DEFAULT_PROMPT_THEME.backgroundColor;
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = style.textColor || '#FFFFFF';
  ctx.font = `600 ${fontSize}px ${style.font || 'Arial'}, sans-serif`;
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, text || '', width - padding * 2);
  const lineHeight = fontSize * 1.35;
  const viewH = height - 48;
  const maxScroll = Math.max(0, lines.length * lineHeight - viewH);
  const offsetY = y + 24 - Math.min(1, Math.max(0, progress)) * maxScroll;

  // Guide line: where a real teleprompter tells the reader to sit. Lines further
  // from it fade so the eye stays anchored as the text moves.
  const guideY = y + height * 0.38;

  lines.forEach((line, i) => {
    const lineY = offsetY + i * lineHeight;
    if (lineY < y - lineHeight || lineY > y + height) return;
    const distance = Math.abs(lineY + lineHeight / 2 - guideY) / (height * 0.5);
    ctx.globalAlpha = guide ? Math.max(0.35, 1 - distance * 0.75) : 1;
    ctx.fillText(line, x + padding, lineY);
  });

  if (guide) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,209,178,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 16, guideY + lineHeight / 2);
    ctx.lineTo(x + width - 16, guideY + lineHeight / 2);
    ctx.stroke();
  }

  ctx.restore();
}
