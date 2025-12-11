import { chromium } from "playwright";

// JobData interface to structure scraped data
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
  RoleLevel?: number | string | undefined; 
}

// Map numeric job levels to human-readable roles
const JOB_LEVEL_MAP: Record<number, string> = {
  1: "Intern", 2: "Entry Level", 3: "Associate", 4: "Mid Level",
  5: "Senior", 6: "Team Lead", 7: "General Manager", 8: "Executive/Director"
};

const BASE_URL = "https://www.zeil.com/jobs/auckland/all";
const CITIES = [
  "Auckland", "Christchurch", "Wellington", "Hamilton",
  "Tauranga", "Dunedin", "Palmerston North", "Whangarei", "Nelson"
];

// Function to normalize location to major cities
function extractCity(text: string | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const city of CITIES) {
    if (lower.includes(city.toLowerCase())) return city;
  }
  return text.trim();
}

// Function to extract salary-related sentences from description
function extractSalary(text: string): string | null {
  const keywords = [
    "salary","remuneration","pay","compensation",
    "bonus","allowance","package","wage","reward"
  ];
  const sentences = text.split(/[\.\n]+/); 
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (keywords.some(k => lower.includes(k))) return sentence.trim();
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true }); // Launch browser
  const page = await browser.newPage();                     

  // Navigate to the specific job page
  await page.goto("https://www.zeil.com/jobs/auckland/all/job/yailr", {
    waitUntil: "networkidle" 
  });
  await page.waitForSelector("div.main-container>main"); 

  // Scrape job details from the page
  const jobData: JobData = await page.evaluate(() => {
    const get = (sel: string) =>
      document.querySelector(sel)?.textContent?.trim() || null;

    // Get hard and soft skills lists
    const uls = document.querySelectorAll(".job-details ul.pills");
    const hardSkills = uls[0]?.textContent?.trim() || null;
    const softSkills = uls[1]?.textContent?.trim() || null;

    // Get job description
    const descEl = document.querySelector(".prose") as HTMLElement;
    const description = descEl ? descEl.innerText.trim() : "";

    return {
      title: get("h2.v2"),
      listingDate: get(".job-details ul.icon-list > li:nth-child(1)"),
      company: get(".plain-text-link"),
      location: get(".job-details div.splitbox > div p.value"),
      employmentType: get(".job-details ul.icon-list > li:nth-child(3)"),
      description,
      listedSalary: get(".job-details div.splitbox>div h4.salary"),
      hardSkills,
      softSkills
    };
  });

  // Normalize location to major cities
  jobData.location = extractCity(jobData.location);

  // If salary not listed, extract from description
  if (jobData.description) {
    jobData.listedSalary = jobData.listedSalary || extractSalary(jobData.description);
  }

  jobData.removalDate = null;

  // Target title in lowercase for comparison
  const targetTitle = (jobData.title || "").toLowerCase();
  let foundLevel: number | null = null;

  // Loop through all job levels and pages
  for (let level = 1; level <= 8 && !foundLevel; level++) {
    for (let p = 1; p <= 3 && !foundLevel; p++) {
      await page.goto(`${BASE_URL}?f_rl=${level}&page=${p}`, {
        waitUntil: "domcontentloaded" // Wait for DOM only
      });

      // Select all job cards in the page
      const jobCards = await page.$$(".job-item");
      for (const job of jobCards) {
        const title = await job.$eval("h3.title.v2", el => el.textContent?.trim() || "");
        if (title.toLowerCase() === targetTitle) { // Compare with target job title
          foundLevel = level;
          break;
        }
      }
    }
  }

  // Map numeric level to role name
  jobData.RoleLevel = foundLevel ? JOB_LEVEL_MAP[foundLevel] : "Not Found";

  console.log("\n FINAL RESULT:\n");
  console.log(jobData);

  await browser.close();
})();
