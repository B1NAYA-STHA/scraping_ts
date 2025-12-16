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


// Utility Functions                                                  

// Extract GTM job info
function parseGtmData($: cheerio.CheerioAPI) {
  const raw = $(".callout a[data-click-gtm-event]").attr("data-click-gtm-event");
  if (!raw) return {};
  try {
    const decoded = raw.replace(/&quot;/g, '"');
    const gtm = JSON.parse(decoded);
    return {
      gtmJobId: gtm.jobId || null,
      title: gtm.jobTitle || null,
      orgId: gtm.orgId || null,
      orgName: gtm.orgName || null,
      locationCity: gtm.locationCity || null,
      locationSuburb: gtm.locationSuburb || null,
      locationRegion: gtm.locationRegion || null,
      workTypes: Array.isArray(gtm.workTypes) ? gtm.workTypes : null,
      workStyle: gtm.workStyle || null,
    };
  } catch {
    return {};
  }
}

// Clean extra whitespace
function cleanText(text?: string | null): string | null {
  if (!text) return null;
  return text.replace(/\s+/g, " ").trim();
}

// Get text from a selector
function getText($: cheerio.CheerioAPI, selector: string): string | null {
  const el = $(selector);
  return el.length ? el.text() : null;
}

// Normalize salary string
function normalizeSalary(text?: string | null): string | null {
  if (!text) return null;
  const parts = text.replace(/\s+/g, " ").trim().split(/(?=\$)/g);
  return [...new Set(parts.map((p) => p.trim()))].join(" ");
}

// Extract salary from job description if not listed on page
function extractSalaryFromDescription(text: string): string | null {
  const regex =
    /\$\d+(?:\.\d+)?(?:\s*-\s*\$\d+(?:\.\d+)?)?\s*(?:\/hr|per hour|per annum|pa)?/gi;
  const matches = text.match(regex);
  if (!matches) return null;
  return normalizeSalary(matches.join(" "));
}


// Async Pool Function - controls concurrency     

async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Promise<void>[] = [];

  for (const [i, item] of array.entries()) {
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    ret.push(p);

    if (poolLimit <= array.length) {
      const e: Promise<void> = p.then(() => void executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}


// Industry & RoleLevel Maps                                          

const INDUSTRY_MAP: Record<number, string> = {
  1: "Accounting", 2: "Administration & Office Support", 3: "Advertising, Arts & Media",
  4: "Banking & Financial Services", 5: "Call Centre & Customer Service", 6: "CEO & General Management",
  7: "Community Services & Development", 8: "Construction", 9: "Consulting & Strategy",
  10: "Design & Architecture", 11: "Education & Training", 12: "Engineering",
  13: "Farming, Animals & Conservation", 14: "Government & Defense", 15: "Healthcare & Medical",
  16: "Hospitality & Tourism", 17: "Human Resources & Recruitment", 18: "Information & Communication Technology",
  19: "Insurance & Superannuation", 20: "Legal", 21: "Manufacturing, Transport & Logistics",
  22: "Marketing & Communications", 23: "Materials, Chemicals & Packaging", 24: "Mining, Resources & Energy",
  25: "Real Estate & Property", 26: "Retail & Consumer Products", 27: "Sales",
  28: "Science & Technology", 29: "Self Employment", 30: "Sport & Recreation",
  31: "Trades & Services", 32: "Utilities",
};

const ROLE_LEVELS: Record<number, string> = {
  1: "Intern", 2: "Entry Level", 3: "Associate", 4: "Mid Level",
  5: "Senior", 6: "Team Lead", 7: "General Manager", 8: "Executive/Director",
};


// Fetch Role Levels Map for all jobs                  

async function getRoleLevelMap(city: string): Promise<Record<string, string>> {
  const cityNorm = city.toLowerCase().replace(/\s+/g, "-");
  const roleMap: Record<string, string> = {};

  console.log(`\nStarting role map extraction`);

  const fetchPage = async (roleId: number, page: number) => {
    const url = `https://www.zeil.com/jobs/${cityNorm}/all?f_rl=${roleId}&page=${page}`;
    const res = await axios.get(url, { headers: HEADERS });
    const $ = cheerio.load(res.data);

    $("h3.title.tile.v2 a").each((_, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/\/job\/([^?]+)/);
      if (match?.[1]) roleMap[match[1]] = ROLE_LEVELS[roleId] || "Not Found";
    });

    return Boolean($("div.paging a").attr("href"));
  };

  for (const roleId of Object.keys(ROLE_LEVELS).map(Number)) {
    let page = 1, hasMore = true;
    while (hasMore) hasMore = await fetchPage(roleId, page++);
  }

  console.log("\nRole map extraction completed.");
  return roleMap;
}


// Fetch Industry Map for all jobs                                     

async function getIndustryMap(city: string): Promise<Record<string, string>> {
  const cityNorm = city.toLowerCase().replace(/\s+/g, "-");
  const industryMap: Record<string, string> = {};

  console.log(`\nStarting industry map extraction`);

  const fetchPage = async (industryId: number, page: number) => {
    const url = `https://www.zeil.com/jobs/${cityNorm}/all?f_oi=${industryId}&page=${page}`;
    const res = await axios.get(url, { headers: HEADERS });
    const $ = cheerio.load(res.data);

    $("h3.title.tile.v2 a").each((_, el) => {
      const href = $(el).attr("href");
      const match = href?.match(/\/job\/([^?]+)/);
      if (match?.[1]) industryMap[match[1]] = INDUSTRY_MAP[industryId] || "Not Found";
    });

    return Boolean($("div.paging a").attr("href"));
  };

  for (const industryId of Object.keys(INDUSTRY_MAP).map(Number)) {
    let page = 1, hasMore = true;
    while (hasMore) hasMore = await fetchPage(industryId, page++);
  }
  console.log("\nIndustry map extraction completed.");

  return industryMap;
}


// Scrape Job Details                                                 

async function getJobDetails(
  job: JobLink,
  roleLevelMap: Record<string, string>,
  industryMap: Record<string, string>,
  numericId: number
): Promise<JobData> {
  const res = await axios.get(job.url, { headers: HEADERS });
  const $ = cheerio.load(res.data);

  const uls = $(".job-details ul.pills");
  const gtm = parseGtmData($);

  const hardSkills = uls.eq(0).find("li").map((_, el) => $(el).text().trim()).get();
  const softSkills = uls.eq(1).find("li").map((_, el) => $(el).text().trim()).get();

  return {
    id: gtm.gtmJobId || null,
    title: gtm.title || null,
    listingDate: cleanText(getText($, ".job-details ul.icon-list > li:nth-child(1)")),
    company: gtm.orgName || null,
    locationCity: gtm.locationCity || null,
    locationRegion: gtm.locationRegion || null,
    locationSuburb: gtm.locationSuburb || null,
    workTypes: gtm.workTypes || null,
    workStyle: gtm.workStyle || null,
    description: cleanText(getText($, ".prose")) || "",
    listedSalary: normalizeSalary(cleanText(getText($, "h4.salary"))) || extractSalaryFromDescription(cleanText(getText($, ".prose")) || ""),
    hardSkills: hardSkills.length ? hardSkills : null,
    softSkills: softSkills.length ? softSkills : null,
    RoleLevel: roleLevelMap[job.id] || "Not Found",
    industry: industryMap[job.id] || "Not Found",
    orgId: gtm.orgId || null,
  };
}


// Main Function    
(async () => {
  try {
    const city = "Hamilton";
    const jobsPath = path.join(__dirname, `${city}_jobs.json`);
    const jobsJson: { city: string; total: number; jobs: JobLink[] } = JSON.parse(await fs.readFile(jobsPath, "utf-8"));

    const roleLevelMap = await getRoleLevelMap(jobsJson.city);
    const industryMap = await getIndustryMap(jobsJson.city);

    console.log(`\nScraping ${jobsJson.jobs.length} jobs\n`);

    const allJobDetails = await asyncPool(10, jobsJson.jobs, async (job, index) => {
      try {
        return await getJobDetails(job, roleLevelMap, industryMap, index + 1);
      } catch {
        console.error(`Failed: ${job.title}`);
        return null;
      }
    });

    const finalJobDetails = allJobDetails.filter(Boolean) as JobData[];

    const missingRole = finalJobDetails.filter(j => !j.RoleLevel || j.RoleLevel === "Not Found");
    const missingIndustry = finalJobDetails.filter(j => !j.industry || j.industry === "Not Found");

    if (missingRole.length) console.log(`Missing RoleLevel jobs: ${missingRole.length}`);
    if (missingIndustry.length) console.log(`Missing Industry jobs: ${missingIndustry.length}`);

    const outputPath = path.join(__dirname, `${city}_job_details.json`);
    await fs.writeFile(outputPath, JSON.stringify({ city: jobsJson.city, totalJobs: finalJobDetails.length, jobs: finalJobDetails }, null, 2));

    console.log(`\nSaved ${finalJobDetails.length} jobs to ${city}_job_details.json`);
  } catch (err) {
    console.error("Error:", err);
  }
})();
