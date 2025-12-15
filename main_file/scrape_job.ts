import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";

// CONFIG
const BASE_URL = "https://www.zeil.com/jobs";
const SITE_URL = "https://www.zeil.com";
const CONCURRENCY_LIMIT = 5; // number of pages fetched concurrently

// Interface for job links
interface JobLink {
  id: string;      // Unique job ID extracted from URL
  title: string;   // Job title
  url: string;     // Full job URL
}

// Fetch single page 
async function fetchPage(cityNorm: string, page: number): Promise<JobLink[]> {
  console.log(`Fetching page ${page}...`);

  const { data: html } = await axios.get(
    `${BASE_URL}/${cityNorm}/all?page=${page}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }
  );

  const $ = cheerio.load(html);
  const jobs: JobLink[] = [];

  $(".title.tile.v2 a").each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr("href");

    if (title && href) {
      // Extract job ID from URL
      const idMatch = href.match(/\/job\/([^?\/]+)/);
      const id = idMatch ? idMatch[1] : " ";

      jobs.push({
        id,       // Add extracted ID
        title,
        url: SITE_URL + href,
      });
    }
  });

  console.log(`Page ${page} → ${jobs.length} jobs`);
  return jobs;
}

// Async pool helper 
async function asyncPool<T, R>(
  poolLimit: number,
  tasks: (() => Promise<R>)[]
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task()
      .then((r) => {
        results.push(r);
      })
      .catch(() => {});
    executing.push(p);

    if (executing.length >= poolLimit) {
      await Promise.race(executing);

      // Remove completed promises
      const settled = await Promise.allSettled(executing);
      for (let i = executing.length - 1; i >= 0; i--) {
        if (settled[i]?.status === "fulfilled") executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// Scrape all job titles 
async function scrapeAllJobTitles(city: string): Promise<JobLink[]> {
  const jobs: JobLink[] = [];
  const cityNorm = city.trim().toLowerCase().replace(/\s+/g, "-");
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    // Prepare batch of tasks with concurrency
    const tasks: (() => Promise<JobLink[]>)[] = [];
    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
      const currentPage = page + i;
      tasks.push(async () => {
        const pageJobs = await fetchPage(cityNorm, currentPage);
        if (pageJobs.length === 0) hasMore = false; // stop if no jobs
        return pageJobs;
      });
    }

    // Run batch concurrently
    const batchResults = await Promise.all(tasks.map((t) => t()));

    // Flatten results
    for (const pageJobs of batchResults) {
      jobs.push(...pageJobs);
    }

    page += CONCURRENCY_LIMIT;
  }

  return jobs;
}

// main function
async function run() {
  const city = "whangarei";
  console.log(`\nScraping jobs`);

  const jobs = await scrapeAllJobTitles(city);

  const output = {
    city,
    total: jobs.length,
    jobs,
  };

  // Save to JSON
  fs.writeFileSync("whangarei_jobs.json", JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nSaved ${jobs.length} jobs to whangarei_jobs.json`);
}

run();
