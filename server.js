const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

// ---------- Configuration Section ---------- //
const LOGIN_URL = "http://app.loops.id/login";
const CAMPAIGN_BASE_URL = "https://app.loops.id/campaign/";
const EMAIL = process.env.LOOPS_EMAIL;
const PASSWORD = process.env.LOOPS_PASSWORD;

const CAMPAIGN_IDS = [
  249397, 275170, 250794, 250554, 250433, 250432, 247001, 246860, 246815, 246551, 246550, 246549, 246548
]; 

const ALLOWED_ADMIN_NAMES = [
  "admin 1", "admin 2", "admin 3", "admin 4",
  "admin 5", "admin 6", "admin 7"
];

const BCAT_URL = process.env.BCAT_URL;
const BCAT_API_KEY = process.env.BCAT_API_KEY;

// WhatsApp Configuration
const FONNTE_API_URL = 'https://api.fonnte.com/send';
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
//const WHATSAPP_TARGET = '120363048415397336@g.us';
const WHATSAPP_TARGET = process.env.WHATSAPP_TARGET;

// Browser management configuration
let browser = null;
let lastBrowserUseTime = null;
const BROWSER_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Request queue for handling concurrent requests
const requestQueue = [];
let isProcessing = false;

// ---------- Browser Management Functions ---------- //

async function getBrowser() {
  try {
    const browser = await chromium.connect(BCAT_URL, {
      headers: {'Api-Key': BCAT_API_KEY},
      headless: true,
      timeout: 30000
    });

    console.log("BrowserCat connection successful!");
    return browser;
  } catch (error) {
    console.error("Detailed BrowserCat Connection Error:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Optional: You could add more specific error handling here
    if (error.message.includes('invalid_api_key')) {
      console.error("API Key appears to be invalid!");
    }

    // Fallback to local browser launch
    console.log("Falling back to local browser launch");
    return await chromium.launch({
      headless: true
    });
  }
}

async function cleanupBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.error("Error closing browser:", error);
    }
    browser = null;
  }
}

// Periodically check and close idle browser
setInterval(async () => {
  const currentTime = Date.now();
  if (browser && lastBrowserUseTime && (currentTime - lastBrowserUseTime) > BROWSER_IDLE_TIMEOUT) {
    console.log("Closing idle browser in scheduled cleanup");
    await cleanupBrowser();
  }
}, BROWSER_IDLE_TIMEOUT);

// ---------- Helper Functions ---------- //

async function login(page) {
  console.log("Logging in...");
  await page.goto(LOGIN_URL, { timeout: 30000 });
  await page.fill("input[name=email]", EMAIL);
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
  console.log("Login successful!");
}

async function navigateToCampaign(page, campaignId) {
  const campaignUrl = `${CAMPAIGN_BASE_URL}${campaignId}`;
  console.log(`Navigating to campaign ID: ${campaignId} at URL: ${campaignUrl}`);
  await page.goto(campaignUrl, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

async function deleteItems(page, times = 2) {
  console.log(`Deleting ${times} items...`);
  for (let i = 0; i < times; i++) {
    await page.waitForSelector("button.secondary.op-delete.icon-subtraction.delete", { timeout: 10000 });
    await page.click("button.secondary.op-delete.icon-subtraction.delete");
    await page.waitForTimeout(1000);
  }
  console.log("Deletion completed.");
}

async function interactWithDropdown(page, containerSelector, value) {
  console.log(`Selecting '${value}' from the dropdown (${containerSelector})`);
  await page.waitForSelector(`${containerSelector} .select2-arrow`, { timeout: 10000 });
  await page.click(`${containerSelector} .select2-arrow`);
  await page.waitForTimeout(500);
  await page.keyboard.type(value);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
}

async function saveChanges(page) {
  const saveButtonSelector = "#app > form > section > article > div.columns.four > div.card.has-sections > div.card-section.secondary.align-right > small > button:nth-child(2)";
  console.log("Saving changes...");
  await page.waitForSelector(saveButtonSelector, { timeout: 10000 });
  await page.click(saveButtonSelector);
  await page.waitForTimeout(1000);
  console.log("Changes saved successfully.");
}

async function processCampaign(page, campaignId, admin1Name, admin2Name) {
  try {
    await navigateToCampaign(page, campaignId);
    await deleteItems(page, 2);

    await interactWithDropdown(page, "#app > form > section > article > div.columns.eight > div:nth-child(2) > div > div:nth-child(1)", admin1Name);

    await page.waitForSelector("button.secondary.op-clone.icon-addition.clone", { timeout: 10000 });
    await page.click("button.secondary.op-clone.icon-addition.clone");
    await interactWithDropdown(page, "#app > form > section > article > div.columns.eight > div:nth-child(2) > div > div:nth-child(2)", admin2Name);

    await saveChanges(page);
    console.log(`Successfully processed campaign ID: ${campaignId}`);
    return true;
  } catch (error) {
    console.error(`Error processing campaign ID ${campaignId}:`, error);
    return false;
  }
}

async function sendWhatsAppMessage(admin1Name, admin2Name, status, finishTime, timeOfDay) {
  // Build the message based on conditions
  const message = buildMessage(admin1Name, admin2Name, status, finishTime, timeOfDay);

  // Send the message via Fonnte API
  return await sendMessageToWhatsApp(message);
}

// Helper function to construct the message
function buildMessage(admin1Name, admin2Name, status, finishTime, timeOfDay) {
  const isSuccess = status === 'success';
  const emoji = isSuccess ? '✅' : '❌';
  const actionText = isSuccess ? 'Successfully set' : 'Failed to set';

  // Standard case
  if (admin1Name === admin2Name) {
    return `${emoji} ${actionText}:\n- ${admin1Name}\n\nat ${finishTime}`;
  } else {
    return `${emoji} ${actionText}:\n- ${admin1Name}\n- ${admin2Name}\n\nat ${finishTime}`;
  }
}

// Helper function to send the message via Fonnte API
async function sendMessageToWhatsApp(message) {
  const config = {
    headers: { 'Authorization': FONNTE_TOKEN },
    timeout: 10000 // 10-second timeout
  };

  try {
    const response = await axios.post(FONNTE_API_URL, {
      target: WHATSAPP_TARGET,
      message: message
    }, config);

    console.log('WhatsApp message sent:', response.data);
    return true;
  } catch (error) {
    const errorDetail = error.response ? error.response.data : error.message;
    console.error('Error sending WhatsApp message:', errorDetail);
    return false;
  }
}

// ---------- Request Processing Queue ---------- //

async function processAutomation(requestData) {
  const { admin1Name, admin2Name, timeOfDay, res } = requestData;
  
  let page = null;
  
  try {
    console.log(`Starting automation with Admin 1: ${admin1Name}, Admin 2: ${admin2Name} for ${timeOfDay}`);
    
    const browser = await getBrowser();
    page = await browser.newPage({ timeout: 60000 });
    console.log("New page opened");
    
    await login(page);

    // Filter campaign IDs based on timeOfDay
    let filteredCampaignIds = CAMPAIGN_IDS;
    if (timeOfDay === "pagi" || timeOfDay === "siang" || timeOfDay === "malam") {
      filteredCampaignIds = CAMPAIGN_IDS.filter(id => id !== 249397);
      console.log("Malam request: Excluding campaign ID 249397");
    } else if (timeOfDay === "dhuha" || timeOfDay === "sore") {
      filteredCampaignIds = [249397]; // Only process 249397 for sore
      console.log("Sore request: Processing only campaign ID 249397");
    }

    let allSuccessful = true;
    for (const campaignId of filteredCampaignIds) {
      console.log(`Processing campaign ${campaignId}`);
      const success = await processCampaign(page, campaignId, admin1Name, admin2Name);
      if (!success) {
        allSuccessful = false;
      }
      await page.waitForTimeout(1000); // 1-second breather between campaigns
    }

    const finishTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    await sendWhatsAppMessage(admin1Name, admin2Name, allSuccessful ? 'success' : 'failure', finishTime, timeOfDay);
    
    res.send(`Automation ${allSuccessful ? 'completed successfully' : 'completed with some errors'} for ${timeOfDay}!`);
  } catch (error) {
    console.error('Automation error:', error);
    const finishTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    await sendWhatsAppMessage(admin1Name, admin2Name, 'failure', finishTime, timeOfDay);
    res.status(500).send(`Automation failed for ${timeOfDay}: ${error.message}`);
  } finally {
    if (page) {
      try {
        await page.close(); // Explicitly close the page
      } catch (error) {
        console.error("Error closing page:", error);
      }
    }
    
    // Try to run garbage collection if exposed
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        console.error("Error running garbage collection:", e);
      }
    }
  }
}

async function addToQueue(requestData) {
  requestQueue.push(requestData);
  processNextInQueue();
}

async function processNextInQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const nextRequest = requestQueue.shift();
  
  try {
    await processAutomation(nextRequest);
  } catch (error) {
    console.error("Error processing queued request:", error);
  } finally {
    isProcessing = false;
    processNextInQueue(); // Process next item
  }
}

// ---------- Server Setup ---------- //

const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.post('/run', async (req, res) => {
  let admin1Name = req.body.admin1;
  let admin2Name = req.body.admin2;
  const timeOfDay = req.body.timeOfDay || "unknown";

  // Special case for sore: override admins to "admin 1"
//   if (timeOfDay === "sore") {
//     admin1Name = "admin 1";
//     admin2Name = "admin 1";
//   }

  if (!ALLOWED_ADMIN_NAMES.includes(admin1Name) || !ALLOWED_ADMIN_NAMES.includes(admin2Name)) {
    return res.status(400).send('Invalid admin names!');
  }

  // Add request to processing queue
  addToQueue({
    admin1Name,
    admin2Name,
    timeOfDay,
    res
  });
});

app.get('/run', (req, res) => {
  res.status(405).send('Method Not Allowed: Please use POST request');
});

// Cleanup on server exit
process.on('SIGINT', async () => {
  console.log('Server shutting down, cleaning up resources...');
  await cleanupBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Server terminating, cleaning up resources...');
  await cleanupBrowser();
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});