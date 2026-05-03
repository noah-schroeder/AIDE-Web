import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const LINE_Y_TOLERANCE = 3;
const COLUMN_GAP_THRESHOLD = 0.08;
const COLUMN_LINE_RATIO = 0.3;
const PARAGRAPH_GAP_FACTOR = 1.5;

function extractPageTextSpatially(textContent, pageWidth) {
  const items = textContent.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width || 0,
      height: item.height || Math.abs(item.transform[3]) || 10
    }));

  if (items.length === 0) return '';

  // Sort by y descending (top of page first), then x ascending
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  // Cluster items into lines by y proximity
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

  // Detect column layout by looking at horizontal gaps
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

  if (!isMultiColumn) {
    return joinLinesWithParagraphs(lines);
  }

  // Multi-column: split items into left and right columns
  const columnMidpoint = gapMidpointSum / gapCount;
  const leftLines = [];
  const rightLines = [];

  for (const line of lines) {
    const leftItems = line.filter((item) => item.x + item.width / 2 < columnMidpoint);
    const rightItems = line.filter((item) => item.x + item.width / 2 >= columnMidpoint);
    if (leftItems.length > 0) leftLines.push(leftItems);
    if (rightItems.length > 0) rightLines.push(rightItems);
  }

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

/**
 * Extract text content from a PDF file with column-aware spatial sorting
 * @param {File} file - PDF file to extract text from
 * @returns {Promise<string>} - Extracted text
 */
export async function extractTextFromPDF(file) {
  let pdf = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
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
