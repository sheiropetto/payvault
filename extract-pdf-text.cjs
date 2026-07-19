const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function main() {
  try {
    const data = fs.readFileSync('october-2023.pdf');
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    console.log('Pages:', result.numpages);
    fs.writeFileSync('october-raw-text.txt', result.text, 'utf8');
    console.log('Text saved, length:', result.text.length);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
