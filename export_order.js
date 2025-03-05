const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const cron = require('node-cron');

// Shopify API credentials
const SHOPIFY_STORE = "your-store-name.myshopify.com";
const ACCESS_TOKEN = "your-access-token";

// File to track last fetched order timestamp
const LAST_FETCH_FILE = "last_fetch.txt";

// Google Sheets credentials
const SHEET_ID = "your-google-sheet-id";
const GOOGLE_CREDENTIALS = require("./google-credentials.json");

async function authenticateGoogleSheets() {
    const auth = new google.auth.GoogleAuth({
        credentials: GOOGLE_CREDENTIALS,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    return google.sheets({ version: "v4", auth: await auth.getClient() });
}

function getLastFetchTime() {
    if (fs.existsSync(LAST_FETCH_FILE)) {
        return fs.readFileSync(LAST_FETCH_FILE, "utf8");
    }
    return null;
}

function updateLastFetchTime(timestamp) {
    fs.writeFileSync(LAST_FETCH_FILE, timestamp, "utf8");
}

async function getOrders() {
    let orders = [];
    let lastFetchTime = getLastFetchTime();
    let url = `https://${SHOPIFY_STORE}/admin/api/2024-01/orders.json?status=any&limit=250`;
    if (lastFetchTime) {
        url += `&created_at_min=${encodeURIComponent(lastFetchTime)}`;
    }

    const headers = {
        "X-Shopify-Access-Token": ACCESS_TOKEN,
        "Content-Type": "application/json"
    };

    try {
        while (url) {
            const response = await axios.get(url, { headers });
            orders = orders.concat(response.data.orders);

            // Check for pagination
            const linkHeader = response.headers.link;
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const nextUrlMatch = linkHeader.match(/<([^>]+)>; rel="next"/);
                url = nextUrlMatch ? nextUrlMatch[1] : null;
            } else {
                url = null;
            }
        }
    } catch (error) {
        console.error("Error fetching orders:", error.response ? error.response.data : error.message);
    }

    return orders;
}

async function updateGoogleSheet(orders) {
    if (!orders.length) {
        console.log("No orders to update in Google Sheets.");
        return;
    }

    const sheets = await authenticateGoogleSheets();
    const values = orders.map(order => [
        order.id, order.created_at, order.email || "N/A", order.total_price, order.currency, order.financial_status
    ]);

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "Orders!A2:F",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        resource: { values }
    });

    console.log("Google Sheet updated successfully.");
    updateLastFetchTime(orders[0].created_at);
}

async function runExport() {
    const orders = await getOrders();
    await updateGoogleSheet(orders);
}

// Schedule the task to run every 6 hours
cron.schedule("0 */6 * * *", () => {
    console.log("Running scheduled export...");
    runExport();
});

// Initial run
runExport();
