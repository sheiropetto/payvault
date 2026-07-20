import * as pdfjsLib from 'pdfjs-dist';

// Set worker path for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function extractTextFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      
      // Group text items by Y-coordinate (line) — like pypdf preserves layout
      const lines = new Map();
      for (const item of content.items) {
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push(item.str);
      }
      
      // Sort lines by Y (top to bottom) and join items on same line
      const sortedYs = [...lines.keys()].sort((a, b) => b - a); // descending Y = top to bottom
      const pageText = sortedYs.map(y => lines.get(y).join('')).join('\n');
      pages.push(pageText);
    }

    return pages;
  } catch (err) {
    console.error('PDF extraction error:', err);
    throw err;
  }
}
