import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";

// Required URLs
const BASE_URL = "https://www.zeil.com/jobs"; 
const SITE_URL = "https://www.zeil.com";      

interface JobLink {
  title: string;
  url: string;
}

async function scrapeAllJobTitles(city: string): Promise<JobLink[]> {
  const uniqueJobs = new Map<string, JobLink>(); // Store unique jobs using URL as key
  let page = 1;                               
  let hasNewData = true;                        

  // Normalize city name for URL
  const cityNorm = city.trim().toLowerCase().replace(/\s+/g, "-"); 
  
  while (hasNewData) {
    console.log(`Scraping page ${page}...`);

    // Fetch HTML of the current page
    const { data: html } = await axios.get(
      `${BASE_URL}/${cityNorm}/all?page=${page}`,
      {
        // Avoid blocking by server
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );

    // Load HTML into cheerio
    const $ = cheerio.load(html); 
    const jobsOnPage: JobLink[] = [];

    // Extract job title and URL
    $(".title.v2 a").each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");

      // Filter out irrelevant links like "All jobs in ..."
      if (title && href && !title.toLowerCase().startsWith("all jobs in")) {
        jobsOnPage.push({
          title,
          url: SITE_URL + href,
        });
      }
    });

    // Check if new jobs were added
    const beforeSize = uniqueJobs.size;
    jobsOnPage.forEach((job) => uniqueJobs.set(job.url, job));
    hasNewData = uniqueJobs.size > beforeSize; 

    page++; // Move to next page
  }

  // Return unique jobs as an array
  return Array.from(uniqueJobs.values()); 
}

// Save jobs to JSON file
async function run() {
  const jobs = await scrapeAllJobTitles("Whangarei");

  fs.writeFileSync("jobs.json", 
    JSON.stringify({
      city: "Whangarei",
      total: jobs.length,
      jobs,
    }, null, 2), 
    "utf-8"
  );

  console.log(`Saved ${jobs.length} jobs to jobs.json`);
}

run();
