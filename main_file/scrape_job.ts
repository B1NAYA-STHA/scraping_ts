import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";

// CONFIG
const BASE_URL = "https://www.zeil.com/jobs";
const SITE_URL = "https://www.zeil.com";
const CONCURRENCY_LIMIT = 5; // number of pages fetched concurrently

// Interface for job links
interface JobLink {
  id: string;      
  title: string;  
  url: string;    
}

// headers
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

// Fetch a single page of jobs
async function fetchPage(cityNorm: string, page: number): Promise<JobLink[]> {
  console.log(`Fetching page ${page}...`);

  const { data: html } = await axios.get(`${BASE_URL}/${cityNorm}/all?page=${page}`, { headers: HEADERS });
  const $ = cheerio.load(html);

  const jobs: JobLink[] = [];
  $(".title.tile.v2 a").each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr("href");

    if (title && href && typeof href === "string") {
      const idMatch = href.match(/\/job\/([^?\/]+)/);
      const id = idMatch ? idMatch[1] : "";

      if (id) {
        jobs.push({ id, title: title, url: SITE_URL + href });
      }
    }
  });

  console.log(`Page ${page} → ${jobs.length} jobs`);
  return jobs;
}

// Async pool for concurrency
async function asyncPool<T>(
  poolLimit: number,
  tasks: (() => Promise<T>)[]
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task()
      .then((res) => results.push(res))
      .catch(() => {});
    executing.push(p);

    if (executing.length >= poolLimit) {
      await Promise.race(executing);
      // Remove fulfilled promises
      for (let i = executing.length - 1; i >= 0; i--) {
        if ((executing[i] as any).settled) executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// Scrape all job titles for a city
async function scrapeAllJobTitles(city: string): Promise<JobLink[]> {
  const cityNorm = city.trim().toLowerCase().replace(/\s+/g, "-");
  const jobs: JobLink[] = [];

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    // Prepare concurrent page fetches
    const tasks = Array.from({ length: CONCURRENCY_LIMIT }, (_, i) => {
      const currentPage = page + i;
      return async () => await fetchPage(cityNorm, currentPage);
    });

    const batchResults = await Promise.all(tasks.map((t) => t()));

    // Flatten results and check if last page reached
    let emptyPageCount = 0;
    for (const pageJobs of batchResults) {
      if (pageJobs.length === 0) emptyPageCount++;
      jobs.push(...pageJobs);
    }

    if (emptyPageCount === CONCURRENCY_LIMIT) hasMore = false;
    page += CONCURRENCY_LIMIT;
  }

  return jobs;
}

// main function
(async function run() {
  try {
    const city = "Hamilton";
    console.log(`\nScraping jobs for ${city}...`);

    const jobs = await scrapeAllJobTitles(city);

    const output = { city, total: jobs.length, jobs };
    fs.writeFileSync(`${city}_jobs.json`, JSON.stringify(output, null, 2), "utf-8");

    console.log(`\nSaved ${jobs.length} jobs to ${city}_jobs.json`);
  } catch (err) {
    console.error("Error:", err);
  }
})();
