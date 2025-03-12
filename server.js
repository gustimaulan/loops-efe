const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');

// ---------- Configuration Section ---------- //
const LOGIN_URL = "http://app.loops.id/login";
const CAMPAIGN_BASE_URL = "https://app.loops.id/campaign/";
const EMAIL = "anurisatria@gmail.com";
const PASSWORD = "Efeindonesia2020";

const CAMPAIGN_IDS = [
  275170, 250794, 250554, 250433, 250432, 247001, 246860, 246815, 246551, 246550, 246549, 246548, 249397
]; 

const ALLOWED_ADMIN_NAMES = [
  "admin 1", "admin 2", "admin 3", "admin 4",
  "admin 5", "admin 6", "admin 7"
];

const BCAT_URL = 'wss://api.browsercat.com/connect';
const API_KEY = 'OuhuW8WPX31W1b3ab90pwMAgMdXRuv4cR4nXEEoDaseYLsZ8PhSlfHUWuZZP7sf2';

// WhatsApp Configuration
const FONNTE_API_URL = 'https://api.fonnte.com/send';
const FONNTE_TOKEN = "TBKYN74wCBMv1TFYVNuG";
const WHATSAPP_TARGET = '120363048415397336@g.us';

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
  } catch (error) {
    console.error(`Error processing campaign ID ${campaignId}:`, error);
    throw error;
  }
}

async function sendWhatsAppMessage(admin1Name, admin2Name, status, finishTime, timeOfDay) {
  let message;
  if (timeOfDay === "sore" && admin1Name === "admin 1" && admin2Name === "admin 1") {
    message = status === 'success' 
      ? `✅ Special Sore Update:\n- Set admin 1 for campaign 249397 only\n\nat ${finishTime}`
      : `❌ Special Sore Update Failed:\n- Failed to set admin 1 for campaign 249397\n\nat ${finishTime}`;
  } else {
    message = admin1Name === admin2Name 
      ? `${status === 'success' ? '✅' : '❌'} ${status === 'success' ? 'Successfully set' : 'Failed to set'}:\n- ${admin1Name}\n\nat ${finishTime}`
      : `${status === 'success' ? '✅' : '❌'} ${status === 'success' ? 'Successfully set' : 'Failed to set'}:\n- ${admin1Name}\n- ${admin2Name}\n\nat ${finishTime}`;
  }

  try {
    const response = await axios.post(FONNTE_API_URL, {
      target: WHATSAPP_TARGET,
      message: message
    }, {
      headers: { 'Authorization': FONNTE_TOKEN }
    });
    console.log('WhatsApp message sent:', response.data);
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.response ? error.response.data : error.message);
  }
}

// ---------- Server Setup ---------- //

const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let isRunning = false; // Concurrency lock

app.post('/run', async (req, res) => {
  if (isRunning) return res.status(429).send('Automation already in progress');
  isRunning = true;

  let admin1Name = req.body.admin1;
  let admin2Name = req.body.admin2;
  const timeOfDay = req.body.timeOfDay || "unknown";

  // Special case for sore: override admins to "admin 1"
  if (timeOfDay === "sore") {
    admin1Name = "admin 1";
    admin2Name = "admin 1";
  }

  if (!ALLOWED_ADMIN_NAMES.includes(admin1Name) || !ALLOWED_ADMIN_NAMES.includes(admin2Name)) {
    isRunning = false;
    return res.status(400).send('Invalid admin names!');
  }

  console.log(`Starting automation with Admin 1: ${admin1Name}, Admin 2: ${admin2Name} for ${timeOfDay}`);

  let browser;

  try {
    console.log("Connecting to BrowserCat...");
    browser = await chromium.connect({
      wsEndpoint: BCAT_URL,
      headers: { 'Api-Key': API_KEY }
    });
    const page = await browser.newPage({ timeout: 60000 });
    console.log("New page opened");
    await login(page);

    // Filter campaign IDs based on timeOfDay
    let filteredCampaignIds = CAMPAIGN_IDS;
    if (timeOfDay === "malam") {
      filteredCampaignIds = CAMPAIGN_IDS.filter(id => id !== 249397);
      console.log("Malam request: Excluding campaign ID 249397");
    } else if (timeOfDay === "sore") {
      filteredCampaignIds = [249397]; // Only process 249397 for sore
      console.log("Sore request: Processing only campaign ID 249397");
    }

    for (const campaignId of filteredCampaignIds) {
      console.log(`Processing campaign ${campaignId}`);
      await processCampaign(page, campaignId, admin1Name, admin2Name);
      await page.waitForTimeout(1000); // 1-second breather between campaigns
    }

    await browser.close();
    const finishTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    await sendWhatsAppMessage(admin1Name, admin2Name, 'success', finishTime, timeOfDay);
    res.send(`Automation completed successfully for ${timeOfDay}!`);
  } catch (error) {
    console.error('Automation error:', error);
    if (browser) await browser.close();
    const finishTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    await sendWhatsAppMessage(admin1Name, admin2Name, 'failure', finishTime, timeOfDay);
    res.status(500).send(`Automation failed for ${timeOfDay}: ${error.message}`);
  } finally {
    isRunning = false; // Release lock
  }
});

app.get('/run', (req, res) => {
  res.status(405).send('Method Not Allowed: Please use POST request');
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});