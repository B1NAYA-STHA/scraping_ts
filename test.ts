import { chromium } from "playwright";

const BASE_URL = "https://www.zeil.com/jobs/auckland/all";
const TARGET_TITLES = [
  "Senior Credit Analyst",
  "Credit Manager"
];

interface JobItem {
  title: string;
  level: number;
  page: number;
}

function isMatching(title: string): boolean {
  const t = title.toLowerCase();
  return TARGET_TITLES.some(target =>
    t.includes(target.toLowerCase())
  );
}

async function scrape() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results: JobItem[] = [];

  for (let level = 1; level <= 8; level++) {
    for (let p = 1; p <= 3; p++) {
      const url = `${BASE_URL}?f_rl=${level}&page=${p}`;
      console.log(`Scraping: ${url}`);

      await page.goto(url, { waitUntil: "domcontentloaded" });

      try {
        await page.waitForSelector(".job-item h3.title.v2", { timeout: 5000 });
      } catch {
        continue;
      }

      const titles = await page.$$eval(".job-item h3.title.v2", els =>
        els.map(el => el.textContent?.trim() || "")
      );

      for (const title of titles) {
        if (isMatching(title)) {
          results.push({ title, level, page: p });
        }
      }
    }
  }

  await browser.close();

  console.log("\n🔍 Matched Results:\n");
  console.table(results);

  if (results.length === 0) {
    console.log("❌ No matching job found in searched pages/levels.");
  }

  return results;
}

scrape();
