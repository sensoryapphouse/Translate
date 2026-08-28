import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const fileUrl = 'file://' + join(__dirname, 'index.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  
  // Type Nemeth mode switch and a number
  await page.type('#buf', '⠸⠩ ⠼⠁ ⠸⠱');
  await new Promise(r => setTimeout(r, 1000));
  
  // Dump ALL word spans to see what got generated!
  const spans = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.word')).map(el => ({
      text: el.textContent,
      dataW: el.dataset.w
    }));
  });
  console.log('Word spans in DOM:', spans);
  
  // Click on the first word
  const firstWord = await page.$('.word');
  if (firstWord) {
    await firstWord.click();
    await new Promise(r => setTimeout(r, 1000));
    
    // Check status bar
    const statusBar = await page.$eval('#warn', el => el.innerHTML).catch(() => 'no warn');
    console.log('Status Bar HTML:', statusBar);
  } else {
    console.log('Could not find word');
  }
  
  await browser.close();
})();
