import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://www.zeil.com/jobs";
const SITE_URL = "https://www.zeil.com";

interface JobLink {
  title: string;
  url: string;
}

async function scrapeAllJobTitles(city: string): Promise<JobLink[]> {
  const uniqueJobs = new Map<string, JobLink>();
  let page = 1;
  let hasNewData = true;

  const cityNorm = city.trim().toLowerCase().replace(/\s+/g, "-");

  while (hasNewData) {
    console.log(`page ${page}...`);

    const { data: html } = await axios.get(
      `${BASE_URL}/${cityNorm}/all?page=${page}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
      }
    );

    const $ = cheerio.load(html);
    const jobsOnPage: JobLink[] = [];

    $(".title.v2 a").each((_, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr("href");

      if (title && href && !title.toLowerCase().startsWith("all jobs in")) {
        jobsOnPage.push({
          title,
          url: SITE_URL + href, 
        });
      }
    });

    const beforeSize = uniqueJobs.size;
    jobsOnPage.forEach((job) => uniqueJobs.set(job.url, job));
    hasNewData = uniqueJobs.size > beforeSize;

    page++;
  }

  return Array.from(uniqueJobs.values());
}

scrapeAllJobTitles("Whangarei").then((jobs) => {
  console.log("Jobs:", jobs);
});
