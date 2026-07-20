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
      
      // Sort items by position: Y descending (top to bottom), X ascending (left to right)
      const items = [...content.items].sort((a, b) => {
        const ay = a.transform ? a.transform[5] : 0;
        const by = b.transform ? b.transform[5] : 0;
        // Group by Y with 2px tolerance
        const yDiff = Math.abs(ay - by);
        if (yDiff > 2) return by - ay; // descending Y = reading order
        const ax = a.transform ? a.transform[4] : 0;
        const bx = b.transform ? b.transform[4] : 0;
        return ax - bx; // ascending X
      });
      
      // Build lines: new line when Y gap > 2px
      const lines = [];
      let currentLine = [];
      let lastY = null;
      
      for (const item of items) {
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          if (currentLine.length > 0) {
            // Join items on the same line — pypdf style (items concatenated)
            lines.push(currentLine.map(it => it.str).join(''));
          }
          currentLine = [];
        }
        currentLine.push(item);
        lastY = y;
      }
      if (currentLine.length > 0) {
        lines.push(currentLine.map(it => it.str).join(''));
      }
      
      pages.push(lines.join('\n'));
    }

    return pages;
  } catch (err) {
    console.error('PDF extraction error:', err);
    throw err;
  }
}
