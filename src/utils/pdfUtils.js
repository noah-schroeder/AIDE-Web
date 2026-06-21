import * as pdfjsLib from 'pdfjs-dist';
// Bundle the worker locally (emitted by Vite as a hashed asset under the app's
// base path) instead of fetching it from a CDN. This guarantees the worker
// version matches the library, removes the third-party request, and keeps the
// app fully self-contained for GitHub Pages / offline use.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const LINE_Y_TOLERANCE = 3;
const COLUMN_GAP_THRESHOLD = 0.08;
const COLUMN_LINE_RATIO = 0.3;
const PARAGRAPH_GAP_FACTOR = 1.5;
const FUZZY_PREFIX_WORDS = 8; // words to match when an exact source quote isn't found

// Map raw pdf.js text-content items into the {str, x, y, width, height} shape used
// throughout this module. height falls back to the transform-derived ascent because
// item.height is frequently 0 in getTextContent output.
function mapTextItems(rawItems) {
  return rawItems
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: item.height || Math.abs(item.transform[3]) || 10
    }));
}

// Cluster items into lines by y proximity. Mutates `items` (sorts in place) and
// returns an array of lines, each sorted left-to-right by x.
function clusterItemsIntoLines(items) {
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let currentLine = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const prevY = currentLine[0].y;
    if (Math.abs(items[i].y - prevY) <= LINE_Y_TOLERANCE) {
      currentLine.push(items[i]);
    } else {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = [items[i]];
    }
  }
  currentLine.sort((a, b) => a.x - b.x);
  lines.push(currentLine);
  return lines;
}

// Returns the x midpoint of a two-column layout, or null if the page is single-column.
function detectColumnMidpoint(lines, pageWidth) {
  let columnGapLines = 0;
  let gapMidpointSum = 0;
  let gapCount = 0;

  for (const line of lines) {
    if (line.length < 2) continue;
    let maxGap = 0;
    let maxGapMidpoint = 0;
    for (let j = 1; j < line.length; j++) {
      const gap = line[j].x - (line[j - 1].x + line[j - 1].width);
      if (gap > maxGap) {
        maxGap = gap;
        maxGapMidpoint = line[j - 1].x + line[j - 1].width + gap / 2;
      }
    }
    if (maxGap > pageWidth * COLUMN_GAP_THRESHOLD) {
      columnGapLines++;
      gapMidpointSum += maxGapMidpoint;
      gapCount++;
    }
  }

  const isMultiColumn = lines.length > 0 && columnGapLines / lines.length >= COLUMN_LINE_RATIO;
  return isMultiColumn ? gapMidpointSum / gapCount : null;
}

// Split each line's items into left/right column lines around the given midpoint.
function splitLinesByColumn(lines, columnMidpoint) {
  const leftLines = [];
  const rightLines = [];
  for (const line of lines) {
    const leftItems = line.filter((item) => item.x + item.width / 2 < columnMidpoint);
    const rightItems = line.filter((item) => item.x + item.width / 2 >= columnMidpoint);
    if (leftItems.length > 0) leftLines.push(leftItems);
    if (rightItems.length > 0) rightLines.push(rightItems);
  }
  return { leftLines, rightLines };
}

// Order the mapped items into reading order (lines of items). For multi-column pages
// this is the full left column followed by the full right column — the same order
// extractPageTextSpatially produces, so the text the LLM quoted concatenates the same way.
function getReadingOrderedLines(items, pageWidth) {
  if (items.length === 0) return [];
  const lines = clusterItemsIntoLines(items);
  const columnMidpoint = detectColumnMidpoint(lines, pageWidth);
  if (columnMidpoint === null) return lines;
  const { leftLines, rightLines } = splitLinesByColumn(lines, columnMidpoint);
  return [...leftLines, ...rightLines];
}

function extractPageTextSpatially(textContent, pageWidth) {
  const items = mapTextItems(textContent.items);
  if (items.length === 0) return '';

  const lines = clusterItemsIntoLines(items);
  const columnMidpoint = detectColumnMidpoint(lines, pageWidth);

  if (columnMidpoint === null) {
    return joinLinesWithParagraphs(lines);
  }

  const { leftLines, rightLines } = splitLinesByColumn(lines, columnMidpoint);
  const leftText = joinLinesWithParagraphs(leftLines);
  const rightText = joinLinesWithParagraphs(rightLines);

  return leftText + (rightText ? '\n\n' + rightText : '');
}

function joinLinesWithParagraphs(lines) {
  if (lines.length === 0) return '';

  const lineTexts = lines.map((line) => line.map((item) => item.str).join(' '));
  const lineHeights = lines.map((line) => {
    const heights = line.map((item) => item.height);
    return heights.reduce((sum, h) => sum + h, 0) / heights.length;
  });

  const avgLineHeight = lineHeights.reduce((sum, h) => sum + h, 0) / lineHeights.length;

  const result = [lineTexts[0]];
  for (let i = 1; i < lines.length; i++) {
    const prevY = lines[i - 1][0].y;
    const currY = lines[i][0].y;
    const verticalGap = prevY - currY;
    if (verticalGap > avgLineHeight * PARAGRAPH_GAP_FACTOR) {
      result.push('');
    }
    result.push(lineTexts[i]);
  }

  return result.join('\n');
}

// Normalize a plain string for fuzzy quote matching: straighten smart quotes,
// rejoin hyphenated line breaks, collapse whitespace, lowercase.
function normalizeForMatch(str) {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/-\s+/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a single normalized search string from reading-ordered lines while keeping,
// for every character of the normalized string, a reference back to the source item
// it came from. This lets us map a matched character range back to the items (and
// thus the coordinates) that produced it. The normalization here must mirror
// normalizeForMatch so a quote normalized by that function aligns with this index.
function buildNormalizedIndex(orderedLines) {
  // Flatten to raw characters, inserting a separator space between items.
  const rawChars = [];
  let first = true;
  for (const line of orderedLines) {
    for (const item of line) {
      if (!first) rawChars.push({ ch: ' ', item: null });
      first = false;
      for (const ch of item.str) rawChars.push({ ch, item });
    }
  }

  let normText = '';
  const normOwners = [];
  let lastWasSpace = false;

  for (let i = 0; i < rawChars.length; i++) {
    let { ch, item } = rawChars[i];

    if (ch === '‘' || ch === '’') ch = "'";
    else if (ch === '“' || ch === '”') ch = '"';

    // Rejoin hyphenated line breaks: drop a '-' followed by whitespace and the whitespace.
    if (ch === '-' && i + 1 < rawChars.length && /\s/.test(rawChars[i + 1].ch)) {
      i++;
      while (i + 1 < rawChars.length && /\s/.test(rawChars[i + 1].ch)) i++;
      continue;
    }

    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      normText += ' ';
      normOwners.push(null);
      lastWasSpace = true;
    } else {
      normText += ch.toLowerCase();
      normOwners.push(item);
      lastWasSpace = false;
    }
  }

  return { normText, normOwners };
}

// Cluster matched items into visual lines and return one union rectangle per line,
// expressed as percentages (0–100) of the page so overlays stay correct at any zoom.
function itemsToPercentRects(items, viewport) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const clusters = [];
  let current = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - current[0].y) <= LINE_Y_TOLERANCE) {
      current.push(sorted[i]);
    } else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);

  const rects = [];
  for (const cluster of clusters) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of cluster) {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.width);
      maxY = Math.max(maxY, it.y + it.height);
    }
    // Convert both PDF-space corners; the viewport transform flips the y axis, so
    // take min/abs rather than assuming which corner ends up on top.
    const [x1, y1] = viewport.convertToViewportPoint(minX, minY);
    const [x2, y2] = viewport.convertToViewportPoint(maxX, maxY);
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x1 - x2);
    const height = Math.abs(y1 - y2);
    rects.push({
      left: (left / viewport.width) * 100,
      top: (top / viewport.height) * 100,
      width: (width / viewport.width) * 100,
      height: (height / viewport.height) * 100
    });
  }
  return rects;
}

/**
 * Locate a source quote on a rendered PDF page and return bounding rectangles.
 * @param {Object} page - a pdf.js page proxy (from pdf.getPage(n))
 * @param {string} quote - the verbatim source quote to find
 * @returns {Promise<Array<{left:number, top:number, width:number, height:number}>>}
 *          rectangles as percentages of the page; empty when nothing is matched.
 */
export async function locateQuoteRects(page, quote) {
  if (!quote) return [];
  const trimmed = quote.trim();
  if (!trimmed || /^(not found|n\/a)$/i.test(trimmed)) return [];

  const textContent = await page.getTextContent();
  const items = mapTextItems(textContent.items);
  if (items.length === 0) return [];

  const viewport = page.getViewport({ scale: 1 });
  const orderedLines = getReadingOrderedLines(items, viewport.width);
  const { normText, normOwners } = buildNormalizedIndex(orderedLines);

  const normQuote = normalizeForMatch(trimmed);
  if (!normQuote) return [];

  // Exact match, then fall back to the first few words (handles LLM truncation).
  let idx = normText.indexOf(normQuote);
  let matchLen = normQuote.length;
  if (idx === -1) {
    const words = normQuote.split(' ').filter(Boolean);
    if (words.length > FUZZY_PREFIX_WORDS) {
      const prefix = words.slice(0, FUZZY_PREFIX_WORDS).join(' ');
      idx = normText.indexOf(prefix);
      matchLen = prefix.length;
    }
  }
  if (idx === -1) return [];

  const owners = [];
  const seen = new Set();
  for (let i = idx; i < idx + matchLen && i < normOwners.length; i++) {
    const owner = normOwners[i];
    if (owner && !seen.has(owner)) {
      seen.add(owner);
      owners.push(owner);
    }
  }
  if (owners.length === 0) return [];

  return itemsToPercentRects(owners, viewport);
}

/**
 * Parse a target page number from an LLM-provided page string.
 * @param {string} pageStr - e.g. "5", "3-5", "p. 7", "N/A"
 * @param {number} numPages - total pages, used to reject out-of-range values
 * @returns {number|null} - the first page number found, or null if none/invalid
 */
export function parseTargetPage(pageStr, numPages) {
  if (pageStr == null) return null;
  const match = String(pageStr).match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  if (numPages && n > numPages) return null;
  return n;
}

/**
 * Extract text content from a PDF file with column-aware spatial sorting
 * @param {File} file - PDF file to extract text from
 * @returns {Promise<string>} - Extracted text
 */
export async function extractTextFromPDF(file) {
  let pdf = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    // isEvalSupported: false keeps pdf.js within a strict CSP (no 'unsafe-eval').
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false });
    pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    let fullText = '';

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const pageText = extractPageTextSpatially(textContent, viewport.width);
      fullText += `\n--- Page ${i} ---\n${pageText}\n`;
    }

    return fullText;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF');
  } finally {
    if (pdf) pdf.destroy();
  }
}

/**
 * Convert a File to a base64 string
 * @param {File} file - File to convert
 * @returns {Promise<string>} - Base64 encoded string (without data URI prefix)
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
