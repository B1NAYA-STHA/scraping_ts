import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interfaces
interface JobData {
  title: string | null;
  listingDate: string | null;
  company: string | null;
  location: string | null;
  employmentType: string | null;
  description: string;
  listedSalary: string | null;
  hardSkills: string | null;
  softSkills: string | null;
  removalDate?: string | null;
  RoleLevel?: string;
}

// Role mapping
const JOB_LEVEL_MAP: Record<number, string> = {
  1: "Intern",
  2: "Entry Level",
  3: "Associate",
  4: "Mid Level",
  5: "Senior",
  6: "Team Lead",
  7: "General Manager",
  8: "Executive/Director",
};

// Helpers
const getText = ($: any, selector: string): string | null =>
  $?.(selector)?.first()?.text()?.trim() || null;

const cleanText = (text: string | null | undefined): string | null =>
  text?.replace(/\s+/g, " ").trim() || null;

function extractSalary(text: string): string | null {
  const keywords = [
    "salary", "remuneration", "pay", "compensation",
    "bonus", "allowance", "package", "wage", "reward",
  ];
  const sentences = text.split(/[\.\n]+/);
  for (const sentence of sentences) {
    if (keywords.some((k) => sentence.toLowerCase().includes(k))) return sentence.trim();
  }
  return null;
}

// Pre-fetch RoleLevel mapping for a city
async function getRoleLevelMap(city: string): Promise<Record<string, string>> {
  const cityNorm = city.toLowerCase().replace(/\s+/g, "-");
  const roleMap: Record<string, string> = {};

  for (let level = 1; level <= 8; level++) {
    let page = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const url = `https://www.zeil.com/jobs/${cityNorm}/all?f_rl=${level}&page=${page}`;
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      const $ = cheerio.load(res.data);
      $(".job-item h3.title.v2").each((_, el) => {
        const title = cleanText($(el).text())?.toLowerCase();
        if (title) roleMap[title] = JOB_LEVEL_MAP[level] || "Not Found";
      });

      const nextPage = $("div.paging a").attr("href");
      if (nextPage) page++;
      else hasMorePages = false;
    }
  }

  return roleMap;
}

// Scrape individual job 
async function getJobDetails(jobUrl: string, roleLevelMap: Record<string, string>): Promise<JobData> {
  const res = await axios.get(jobUrl, {
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
  });

  const $ = cheerio.load(res.data);
  const uls = $(".job-details ul.pills");
  const locationRaw = cleanText(getText($, ".job-details div.splitbox > div p.value"));

  const jobData: JobData = {
    title: cleanText(getText($, "h2.v2")),
    listingDate: cleanText(getText($, ".job-details ul.icon-list > li:nth-child(1)")),
    company: cleanText(getText($, ".plain-text-link")),
    location: locationRaw,
    employmentType: cleanText(getText($, ".job-details ul.icon-list > li:nth-child(3)")),
    description: cleanText(getText($, ".prose")) || "",
    listedSalary: cleanText(getText($, ".job-details div.splitbox>div h4.salary")),
    hardSkills: uls.eq(0).length ? cleanText(uls.eq(0).text()) : null,
    softSkills: uls.eq(1).length ? cleanText(uls.eq(1).text()) : null,
  };

  if (!jobData.listedSalary && jobData.description) {
    jobData.listedSalary = extractSalary(jobData.description);
  }

  // Lookup RoleLevel from pre-fetched map
  jobData.RoleLevel = roleLevelMap[jobData.title?.toLowerCase() || ""] || "Not Found";

  return jobData;
}

// Concurrency helper 
async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T) => Promise<R>
): Promise<R[]> {
  const ret: R[] = [];
  const executing: Promise<any>[] = [];

  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p as unknown as R);

    const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
    executing.push(e);

    if (executing.length >= poolLimit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(ret);
}

// Main Function
(async () => {
  try {
    const jobsPath = path.join(__dirname, "jobs.json");
    const jobsRaw = await fs.readFile(jobsPath, "utf-8");
    const jobsJson: { city: string; total: number; jobs: { title: string; url: string }[] } = JSON.parse(jobsRaw);

    console.log(`Pre-fetching RoleLevel map for city: ${jobsJson.city}...`);
    const roleLevelMap = await getRoleLevelMap(jobsJson.city);
    console.log("RoleLevel map ready.\n");

    console.log(`Scraping ${jobsJson.jobs.length} jobs concurrently...\n`);
    const allJobDetails = await asyncPool(10, jobsJson.jobs, async (job) => {
      try {
        return await getJobDetails(job.url, roleLevelMap);
      } catch (err) {
        console.error(`Failed: ${job.title}`);
        return null;
      }
    });

    const finalJobDetails = allJobDetails.filter((j) => j !== null);

    const outputPath = path.join(__dirname, "job_details.json");
    await fs.writeFile(outputPath, JSON.stringify(finalJobDetails, null, 2), "utf-8");

    console.log(`\nSaved ${finalJobDetails.length} job details to job_details.json`);
  } catch (err) {
    console.error("Error: ", err);
  }
})();
