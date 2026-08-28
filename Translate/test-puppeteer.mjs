import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/');
  
  // Type Nemeth mode switch and a number
  await page.type('#brailleBox', '⠸⠩ ⠼⠁ ⠸⠱');
  await new Promise(r => setTimeout(r, 1000));
  
  // Click on the first word (⠸⠩)
  const firstWord = await page.$('.word[data-w="0:0"]');
  if (firstWord) {
    await firstWord.click();
    await new Promise(r => setTimeout(r, 1000));
    
    // Check status bar
    const statusBar = await page.$eval('#statusBar', el => el.innerHTML);
    console.log('Status Bar HTML:', statusBar);
  } else {
    console.log('Could not find word');
  }
  
  await browser.close();
})();
