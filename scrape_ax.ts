import axios from "axios";
import * as cheerio from "cheerio";

// JobData interface
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

const CITIES = [
  "Auckland", "Christchurch", "Wellington", "Hamilton",
  "Tauranga", "Dunedin", "Palmerston North", "Whangarei", "Nelson"
];

// Map numeric job levels to actual roles
const JOB_LEVEL_MAP: Record<number, string> = {
  1: "Intern", 2: "Entry Level", 3: "Associate", 4: "Mid Level",
  5: "Senior", 6: "Team Lead", 7: "General Manager", 8: "Executive/Director"
};

// Helpers
const getText = ($: any, selector: string): string | null =>
  $?.(selector)?.first()?.text()?.trim() || null;

const cleanText = (text: string | null | undefined): string | null =>
  text?.replace(/\s+/g, " ").trim() || null;

// Extract salary from description if missing
function extractSalary(text: string): string | null {
  const keywords = ["salary","remuneration","pay","compensation",
                    "bonus","allowance","package","wage","reward"];
  const sentences = text.split(/[\.\n]+/);
  for (const sentence of sentences) {
    if (keywords.some(k => sentence.toLowerCase().includes(k))) return sentence.trim();
  }
  return null;
}

// Main function to scrape job details from a specific job page
async function getJobDetails(jobUrl: string): Promise<JobData> {
  // Fetch HTML content of the job page
  const res = await axios.get(jobUrl, {
    //Set a custom User-Agent to mimic a real browser request
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  const $ = cheerio.load(res.data); // Load HTML into Cheerio
  const uls = $(".job-details ul.pills");

  const locationRaw = cleanText(getText($, ".job-details div.splitbox > div p.value"));

  // Construct the JobData object by scraping all fields
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

  // Extract salary from description if missing
  if (!jobData.listedSalary && jobData.description) {
    jobData.listedSalary = extractSalary(jobData.description);
  }

  // Get role level
  jobData.RoleLevel = await getRoleLevel(jobData.title || "", jobData.location);

  return jobData;
}

// Determine Role Level
async function getRoleLevel(title: string, city: string | null): Promise<string> {
  title = title.toLowerCase();
  const cityUrlPart = city ? city.toLowerCase().replace(/\s+/g, '-') : "auckland";

  // Loop through all levels and pages
  for (let level = 1; level <= 8; level++) {
    for (let page = 1; page <= 3; page++) {
      const url = `https://www.zeil.com/jobs/${cityUrlPart}/all?f_rl=${level}&page=${page}`;

      // Fetch the listing page HTML
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      const $ = cheerio.load(res.data);
      const jobCards = $(".job-item h3.title.v2").toArray();

      // Check each job card if the title matches
      for (const card of jobCards) {
        const jobTitle = cleanText($(card).text())?.toLowerCase();
        if (jobTitle === title) return JOB_LEVEL_MAP[level] || "Unknown";
      }
    }
  }

  return "Not Found";
}

// Run
(async () => {
  const job = await getJobDetails("https://www.zeil.com/jobs/job/tbexw");
  console.log("\nFINAL RESULT:\n", job);
})();
