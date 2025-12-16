import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// HTTP Headers 
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const CONCURRENCY = 10;

// Interfaces  
interface JobLink {
  id: string;
  title: string;
  url: string;
}

interface JobData {
  id: string | null;
  title: string | null;
  listingDate: string | null;
  company: string | null;
  locationCity?: string | null;
  locationSuburb?: string | null;
  locationRegion?: string | null;
  workTypes?: string[] | null;
  workStyle?: string | null;
  description: string;
  listedSalary: string | null;
  hardSkills: string[] | null;
  softSkills: string[] | null;
  RoleLevel?: string;
  industry?: string;
  orgId?: string | null;
}

// Industry & RoleLevel Maps    

const ROLE_LEVELS: Record<number, string> = {
  1: "Intern", 2: "Entry Level", 3: "Associate", 4: "Mid Level",
  5: "Senior", 6: "Team Lead", 7: "General Manager", 8: "Executive/Director",
};

const INDUSTRY_MAP: Record<number, string> = {
  1: "Accounting", 2: "Administration & Office Support", 3: "Advertising, Arts & Media", 4: "Banking & Financial Services",
  5: "Call Centre & Customer Service", 6: "CEO & General Management", 7: "Community Services & Development", 8: "Construction",
  9: "Consulting & Strategy", 10: "Design & Architecture", 11: "Education & Training", 12: "Engineering",
  13: "Farming, Animals & Conservation", 14: "Government & Defense", 15: "Healthcare & Medical", 16: "Hospitality & Tourism",
  17: "Human Resources & Recruitment", 18: "Information & Communication Technology",
  19: "Insurance & Superannuation", 20: "Legal", 21: "Manufacturing, Transport & Logistics", 22: "Marketing & Communications",
  23: "Materials, Chemicals & Packaging", 24: "Mining, Resources & Energy", 25: "Real Estate & Property", 26: "Retail & Consumer Products",
  27: "Sales", 28: "Science & Technology", 29: "Self Employment", 30: "Sport & Recreation",
  31: "Trades & Services", 32: "Utilities",
};

// Utility Functions                                                  

// Extract GTM job info
function parseGtmData($: cheerio.CheerioAPI) {
  const raw = $(".callout a[data-click-gtm-event]").attr("data-click-gtm-event");
  if (!raw) return {};
  try {
    return JSON.parse(raw.replace(/&quot;/g, '"'));
  } catch {
    return {};
  }
}

const cleanText = (t?: string | null) =>
  t ? t.replace(/\s+/g, " ").trim() : null;

const normalizeSalary = (text?: string | null) => {
  if (!text) return null;
  const parts = text.split(/(?=\$)/g).map(p => p.trim());
  return [...new Set(parts)].join(" ");
};

const extractSalaryFromDescription = (text: string) => {
  const regex =
    /\$\d+(?:\.\d+)?(?:\s*-\s*\$\d+(?:\.\d+)?)?\s*(?:\/hr|per hour|per annum|pa)?/gi;
  const match = text.match(regex);
  return match ? normalizeSalary(match.join(" ")) : null;
};


// Async Pool Function - controls concurrency

async function asyncPool<T, R>(
  limit: number,
  list: T[],
  fn: (item: T) => Promise<R>
) {
  const ret: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const item of list) {
    const p = fn(item);
    ret.push(p);

    if (limit <= list.length) {
      const e: Promise<void> = p.then(() => void executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= limit) await Promise.race(executing);
    }
  }
  return Promise.all(ret);
}

// Fetch location Map for all job
async function getLocationMap(city: string): Promise<JobLink[]> {
  const citySlug = city.toLowerCase().replace(/\s+/g, "-");
  const jobs: JobLink[] = [];
  let page = 1;

  while (true) {
    const res = await axios.get(
      `https://www.zeil.com/jobs/${citySlug}/all?page=${page}`,
      { headers: HEADERS }
    );

    const $ = cheerio.load(res.data);
    const pageJobs = $("h3.title.tile.v2 a")
      .map((_, el) => {
        const href = $(el).attr("href");
        if (!href) return null;

        const id = href.match(/\/job\/([^?]+)/)?.[1];
        if (!id) return null;

        return {
          id,
          title: $(el).text().trim(),
          url: "https://www.zeil.com" + href,
        };
      })
      .get();

    if (!pageJobs.length) break;
    jobs.push(...pageJobs);
    page++;
  }

  console.log(`Found ${jobs.length} jobs in ${city}`);
  return jobs;
}

// Filter map builder(for role level and industry)

async function buildFilterMap(
  city: string,
  param: string,
  sourceMap: Record<number, string>
) {
  const citySlug = city.toLowerCase().replace(/\s+/g, "-");
  const map: Record<string, string> = {};

  for (const id of Object.keys(sourceMap).map(Number)) {
    let page = 1;
    while (true) {
      const res = await axios.get(
        `https://www.zeil.com/jobs/${citySlug}/all?${param}=${id}&page=${page}`,
        { headers: HEADERS }
      );

      const $ = cheerio.load(res.data);
      const links = $("h3.title.tile.v2 a");

      if (!links.length) break;

      links.each((_, el) => {
        const jobId = $(el).attr("href")?.match(/\/job\/([^?]+)/)?.[1];
        if (jobId) map[jobId] = sourceMap[id] || "Not Found";
      });

      page++;
    }
  }

  return map;
}

// Scrape Job Details     

async function getJobDetails( job: JobLink, roleMap: Record<string, string>, industryMap: Record<string, string> ): Promise<JobData> {
  const res = await axios.get(job.url, { headers: HEADERS });
  const $ = cheerio.load(res.data);
  const gtm = parseGtmData($);

  const skills = $(".job-details ul.pills");

  return {
    id: gtm.jobId || null,
    title: gtm.jobTitle || null,
    listingDate: cleanText(
      $(".job-details ul.icon-list li").first().text()
    ),
    company: gtm.orgName || null,
    locationCity: gtm.locationCity || null,
    locationRegion: gtm.locationRegion || null,
    locationSuburb: gtm.locationSuburb || null,
    workTypes: gtm.workTypes || null,
    workStyle: gtm.workStyle || null,
    description: cleanText($(".prose").text()) || "",
    listedSalary: normalizeSalary(cleanText($("h4.salary").text())) || extractSalaryFromDescription($(".prose").text()),
    hardSkills: skills.eq(0).find("li").map((_, el) => $(el).text().trim()).get() || null,
    softSkills: skills.eq(1).find("li").map((_, el) => $(el).text().trim()).get() || null,
    RoleLevel: roleMap[job.id] || "Not Found",
    industry: industryMap[job.id] || "Not Found",
    orgId: gtm.orgId || null,
  };
}

// Main function

(async () => {
  try {
    const cities = ["Whangarei", "Hamilton", "Tauranga"];

    for (const city of cities) {
      console.log(`\nProcessing city: ${city}`);

      const jobs = await getLocationMap(city);

      console.log(`\nStarting role level map extraction`);
      const roleMap = await buildFilterMap(city, "f_rl", ROLE_LEVELS);

      console.log(`\nStarting industry map extraction`);
      const industryMap = await buildFilterMap(city, "f_oi", INDUSTRY_MAP);

      const results = await asyncPool(CONCURRENCY, jobs, async job => {
        try {
          return await getJobDetails(job, roleMap, industryMap);
        } catch {
          return null;
        }
      });

      const finalJobs = results.filter(Boolean) as JobData[];

      const missingRole = finalJobs.filter(j => j.RoleLevel === "Not Found").length;
      const missingIndustry = finalJobs.filter(j => j.industry === "Not Found").length;

      console.log(`Missing RoleLevel jobs: ${missingRole}`);
      console.log(`Missing Industry jobs: ${missingIndustry}`);

      const out = path.join(__dirname, `${city}_job_details.json`);
      await fs.writeFile(out, JSON.stringify({ city, totalJobs: finalJobs.length, jobs: finalJobs }, null, 2));

      console.log(`Saved ${finalJobs.length} jobs to ${city}_job_details.json`);
    }
  } catch (err) {
    console.error("error:", err);
  }
})();
